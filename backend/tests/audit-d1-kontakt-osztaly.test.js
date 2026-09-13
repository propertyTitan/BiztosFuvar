// =====================================================================
//  TELJES AUDIT — D1 csomag (2026-09-13): a kontakt-kikerülés OSZTÁLYA
//
//  A második audit-kör 3 P0-ja + a hozzájuk tartozó P1-ek mind ugyanaz a
//  minta: a díj-kapu ott épült meg, ahol felfedezték (chat, leírás,
//  ajánlat-üzenet), az EGYENÉRTÉKŰ utakon nem. Ez a fájl az osztályt méri:
//   - indok-mezők (lemondás / újranyitás, fuvar + foglalás): típus, hossz,
//     kontakt-szűrő; az indok nem jut a díj előtti szállítóhoz / socketre
//   - a kontakt-szűrő link / domain / üzenetküldő / @handle mintái
//   - fotó: MINDEN nem-hirdetési típus a díj után
//   - GET /jobs orákulumok: házszám-szondázás a város-szűrővel,
//     trilateráció a sugár-szűrővel / távolság-annotációval
//   - a feladó fizetési munkamenete (barion_*) sehol nem a szállítóé
//   - a 6 jegyű kód nem a levél tárgyában és nem a Sentry-extrában
//   - kívülálló nem nézheti meg a már nem nyitott fuvart; az értékelés
//     ügylet-azonosítója csak a feleké
//  Minden teszt a javítás NÉLKÜL igazoltan piros (lásd a PR-t).
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
const request = require('supertest');
const {
  app, db, createUser, createJob, createBooking, TINY_PNG,
} = require('./helpers');
const realtime = require('../src/realtime');
const email = require('../src/services/email');
const Sentry = require('@sentry/node');
const { detectContactLeak, ellenorizIndok } = require('../src/utils/contactGuard');
const { maskInText } = require('../src/utils/mask');

const auth = (t) => ({ Authorization: `Bearer ${t}` });

afterEach(() => vi.restoreAllMocks());

describe('D1 — indok-mezők kapuja (lemondás / újranyitás)', () => {
  it('újranyitás indoka telefonszámmal → 400 CONTACT_LEAK, a fuvar marad elfogadott, a szállító nem kap belőle értesítést', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted' });
    const r = await request(app).post(`/jobs/${job.id}/reopen`).set(auth(shipper.token))
      .send({ reason: 'Inkább hívj közvetlenül: 06 30 123 4567, olcsóbb lesz' });
    expect(r.status, 'az indok szűretlenül ment a leváltott szállító értesítésébe').toBe(400);
    expect(r.body.code).toBe('CONTACT_LEAK');
    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('accepted');
    const { rows: notif } = await db.query(
      `SELECT body FROM notifications WHERE user_id = $1 AND type = 'job_reopened'`, [carrier.id],
    );
    expect(notif, 'értesítés ment a szállítónak az elutasított indokkal').toEqual([]);
  });

  it('lemondás indoka: link → 400; nem-string → 400 INVALID_REASON; 501 karakter → 400 REASON_TOO_LONG', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const link = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(shipper.token))
      .send({ reason: 'Megtalálsz a fuvaros-gyula.hu oldalon' });
    expect(link.status, 'a domain átment a lemondás indokán').toBe(400);
    expect(link.body.code).toBe('CONTACT_LEAK');
    const objektum = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(shipper.token))
      .send({ reason: { hivj: '0630' } });
    expect(objektum.status).toBe(400);
    expect(objektum.body.code).toBe('INVALID_REASON');
    const hosszu = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(shipper.token))
      .send({ reason: 'x'.repeat(501) });
    expect(hosszu.status).toBe(400);
    expect(hosszu.body.code).toBe('REASON_TOO_LONG');
    const { rows } = await db.query('SELECT status FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status, 'az elutasított indok ellenére lemondódott').toBe('bidding');
  });

  it('foglalás lemondása: Viber/@handle az indokban → 400 CONTACT_LEAK (a foglalási ág párja)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'pending' });
    const r = await request(app).post(`/route-bookings/${booking.id}/cancel`).set(auth(shipper.token))
      .send({ reason: 'Viberen keress: @gyula_fuvar' });
    expect(r.status, 'a foglalás-lemondás indoka szűretlen volt').toBe(400);
    expect(r.body.code).toBe('CONTACT_LEAK');
  });

  it('a lemondás indoka a díj ELŐTT nem jut a kijelölt szállítóhoz (cancel_reason), a feladó látja', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted' });
    const r = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(shipper.token))
      .send({ reason: 'Meggondoltam magam, bocs.' });
    expect(r.status).toBe(200);
    const sajat = await request(app).get(`/jobs/${job.id}`).set(auth(shipper.token));
    expect(sajat.body.cancel_reason).toBe('Meggondoltam magam, bocs.');
    const szallito = await request(app).get(`/jobs/${job.id}`).set(auth(carrier.token));
    expect(szallito.status).toBe(200);
    expect(szallito.body, 'a díj előtti szállító megkapta a feladó szabad szövegét').not.toHaveProperty('cancel_reason');
  });

  it('a job:reopened socket-esemény NEM viszi az indokot', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted' });
    const emit = vi.spyOn(realtime, 'emitToJob').mockImplementation(() => {});
    const r = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(carrier.token))
      .send({ reason: 'Elromlott az autó.' });
    expect(r.status).toBe(200);
    expect(r.body.reopened).toBe(true);
    const ujranyitas = emit.mock.calls.find((c) => c[1] === 'job:reopened');
    expect(ujranyitas, 'nem ment job:reopened esemény').toBeTruthy();
    expect(ujranyitas[2], 'az indok a fuvar szobájába ment (a leváltott szállító is hallja)').not.toHaveProperty('reason');
  });

  it('ellenorizIndok: üres/hiányzó → null; whitespace-trim; 500 karakter még OK', () => {
    expect(ellenorizIndok(undefined)).toEqual({ ok: true, value: null });
    expect(ellenorizIndok('   ')).toEqual({ ok: true, value: null });
    expect(ellenorizIndok('  rendben  ')).toEqual({ ok: true, value: 'rendben' });
    expect(ellenorizIndok('y'.repeat(500)).ok).toBe(true);
  });
});

describe('D1 — a kontakt-szűrő link / üzenetküldő / handle osztálya', () => {
  const SZIVAROG = [
    'keress a fuvaros.hu-n', 'nézd meg: https://gofuvar.hu/profil', 'www.pelda.com',
    'írj Viberen', 'WhatsAppon elérsz', 'Telegramon: @gyula_fuvar', 'messengeren dumáljunk',
    'insta: @gyula.fuvar', 'Signal is jó', 'GOFUVAROS.HU',
    // hasonmás hoszt: NEM ismert bolt
    'https://www.ikea.com.csalo.hu/x', 'ikea.com.fuvaros.hu',
  ];
  const TISZTA = [
    'Egy 3 személyes kanapé, 2. emelet, lift nincs.',
    'Facebook Marketplace-en vettem a szekrényt, onnan kell elhozni.',
    'Délután 4-kor.De csak ha ráér.',
    'Tömeg kb. 40 kg, pl. bútor, 3.5 méter hosszú.',
    'Két doboz @ 500 Ft.',
    'IKEA-ból, Budapest, Örs vezér tere 25.',
    'Szignálom ha kész.',
    // A „Hozasd el" flow a leírásba írja a termék linkjét (05-ös E2E)
    'Forrás (IKEA): https://www.ikea.com/hu/hu/p/billy-konyvespolc-feher-00263850/',
    'Jófogásról: https://www.jofogas.hu/budapest/kanape-123456',
    'ikea.com-ról hozasd el, obi.hu a másik.',
  ];
  for (const t of SZIVAROG) {
    it(`fogja: ${JSON.stringify(t)}`, () => {
      expect(detectContactLeak(t), 'a platformon kívüli csatorna átment a szűrőn').not.toBeNull();
    });
  }
  for (const t of TISZTA) {
    it(`átengedi: ${JSON.stringify(t)}`, () => {
      expect(detectContactLeak(t)).toBeNull();
    });
  }
});

describe('D1 — fotó: minden nem-hirdetési típus a díj után', () => {
  it('fuvar: document/damage fotó a díj ELŐTT → 409; a díj után nem 409', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const fizetetlen = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted' });
    for (const kind of ['document', 'damage']) {
      const r = await request(app).post(`/jobs/${fizetetlen.id}/photos`).set(auth(carrier.token))
        .field('kind', kind)
        .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' });
      expect(r.status, `a(z) ${kind} fotó a díj előtt is feltölthető volt (egy lefotózott névjegy = kontakt)`).toBe(409);
    }
    const fizetett = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true });
    const ok = await request(app).post(`/jobs/${fizetett.id}/photos`).set(auth(carrier.token))
      .field('kind', 'document')
      .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' });
    expect(ok.status, 'a díj UTÁN a document fotó tiltva lett').not.toBe(409);
  });

  it('foglalás: damage fotó a díj ELŐTT → 409', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'confirmed' });
    const r = await request(app).post(`/route-bookings/${booking.id}/photos`).set(auth(carrier.token))
      .field('kind', 'damage')
      .attach('file', TINY_PNG, { filename: 'x.png', contentType: 'image/png' });
    expect(r.status, 'a foglalás damage fotója a díj előtt is feltölthető volt').toBe(409);
  });
});

describe('D1 — GET /jobs orákulumok', () => {
  it('házszám-szondázás: a város-szűrő nem tesz különbséget „utca 12" és „utca 13" között', async () => {
    const shipper = await createUser();
    const bongeszo = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, status: 'bidding',
      pickupAddress: 'Budapest, Szondázó Lajos utca 12, 1053',
    });
    const talal = async (q) => (await request(app)
      .get(`/jobs?status=bidding&pickup_city=${encodeURIComponent(q)}`).set(auth(bongeszo.token)))
      .body.map((j) => j.id);
    expect(await talal('Szondázó Lajos utca'), 'az utca-szintű keresés nem találja').toContain(job.id);
    expect(await talal('Szondázó Lajos utca 12')).toContain(job.id);
    expect(await talal('Szondázó Lajos utca 13'),
      'a szűrő a NYERS címen fut: a 12-es találat / 13-as nem-találat kiadja a házszámot').toContain(job.id);
    const valasz = (await request(app).get(`/jobs?status=bidding`).set(auth(bongeszo.token)))
      .body.find((j) => j.id === job.id);
    expect(valasz.pickup_address, 'a válasz utca-szintű marad').not.toContain('12');
  });

  it('trilateráció: a sugár-szűrés és a távolság a KEREKÍTETT (~110 m) koordinátától megy', async () => {
    const shipper = await createUser();
    const bongeszo = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    // A nyers pont ~50 m-re van a 3 tizedesre kerekített ponttól.
    await db.query('UPDATE jobs SET pickup_lat = 47.4984, pickup_lng = 19.0404 WHERE id = $1', [job.id]);
    const kerekLat = 47.498;
    const kerekLng = 19.040;
    // 20 m-es sugár a kerekített pontból: kerekített távolság 0 → benne; a
    // nyers ~50 m → kimaradna (és a szondázó ebből tudná a pontos helyet).
    const r = await request(app)
      .get(`/jobs?status=bidding&lat=${kerekLat}&lng=${kerekLng}&radius_km=0.02`).set(auth(bongeszo.token));
    expect(r.status).toBe(200);
    const talalat = r.body.find((j) => j.id === job.id);
    expect(talalat, 'a sugár-szűrés a NYERS koordinátától mért (a kerekített pont kimaradt)').toBeTruthy();
    expect(talalat.distance_to_pickup_km, 'a távolság a nyers ponttól számolódott').toBe(0);
    expect(Number(talalat.pickup_lat)).toBe(kerekLat);
  });
});

describe('D1 — a feladó fizetési munkamenete nem a szállítóé', () => {
  it('GET /jobs/:id + /payments/jobs/:id/escrow: a szállító nem kap barion_*-ot, a feladó igen', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true });
    await db.query(
      `UPDATE escrow_transactions SET barion_gateway_url = 'https://psp.example/pay/titok' WHERE job_id = $1`, [job.id],
    );
    const sz = await request(app).get(`/jobs/${job.id}`).set(auth(carrier.token));
    expect(sz.status).toBe(200);
    expect(sz.body).not.toHaveProperty('barion_gateway_url');
    expect(sz.body).not.toHaveProperty('barion_payment_id');
    const f = await request(app).get(`/jobs/${job.id}`).set(auth(shipper.token));
    expect(f.body.barion_gateway_url).toBe('https://psp.example/pay/titok');

    const eSz = await request(app).get(`/jobs/${job.id}/escrow`).set(auth(carrier.token));
    expect(eSz.status).toBe(200);
    expect(eSz.body.status).toBe('released');
    expect(eSz.body, 'a szállító megkapta a feladó gateway-linkjét').not.toHaveProperty('barion_gateway_url');
    expect(eSz.body).not.toHaveProperty('barion_payment_id');
    const eF = await request(app).get(`/jobs/${job.id}/escrow`).set(auth(shipper.token));
    expect(eF.body.barion_gateway_url).toBe('https://psp.example/pay/titok');
  });

  it('GET /route-bookings/:id: a szállító nem kap barion_*-ot', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'confirmed', paid: true });
    await db.query(
      `UPDATE route_bookings SET barion_gateway_url = 'https://psp.example/pay/titok', barion_payment_id = 'psp-1' WHERE id = $1`,
      [booking.id],
    );
    const r = await request(app).get(`/route-bookings/${booking.id}`).set(auth(carrier.token));
    expect(r.status).toBe(200);
    expect(r.body).not.toHaveProperty('barion_gateway_url');
    expect(r.body).not.toHaveProperty('barion_payment_id');
  });
});

describe('D1 — a 6 jegyű kód nem a tárgyban és nem a riasztásban', () => {
  let eredetiFetch; let eredetiKulcs;
  const setup = () => {
    eredetiFetch = global.fetch;
    eredetiKulcs = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 're_teszt_hamis_kulcs';
    process.env.EMAIL_RETRY_BACKOFF_MS = '1,1';
    email.__resetEmailAlertsForTests?.();
  };
  const teardown = () => {
    global.fetch = eredetiFetch;
    if (eredetiKulcs === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = eredetiKulcs;
    delete process.env.EMAIL_RETRY_BACKOFF_MS;
  };

  it('a címzetti felvételi e-mail TÁRGYA nem tartalmazza a kódot (a törzs igen)', async () => {
    setup();
    try {
      const kuldott = [];
      global.fetch = vi.fn(async (url, opts) => {
        kuldott.push(JSON.parse(opts.body));
        return { ok: true, status: 200, text: async () => '{"id":"re_ok"}', json: async () => ({ id: 're_ok' }) };
      });
      await email.sendRecipientPickupEmail({
        to: 'cimzett@example.com', recipientName: 'Címzett', jobTitle: 'Kanapé', trackingUrl: 'https://gofuvar.hu/t/x',
        deliveryCode: '548404', carrierName: 'Szállító', carrierPhone: '+36201234567',
      });
      expect(kuldott.length).toBe(1);
      expect(kuldott[0].subject, 'a kód a tárgyban ment (értesítés-előnézet, zárolt képernyő)').not.toContain('548404');
      expect(kuldott[0].html).toContain('548404');
    } finally { teardown(); }
  });

  it('végleges e-mail-kiesés: a Sentry-extra nem tartalmaz 6 jegyű kódot, sem nyers tárgyat', async () => {
    setup();
    try {
      global.fetch = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'upstream', json: async () => ({}) }));
      const capture = vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => 'x');
      await email.sendEmail({ to: 'cimzett@example.com', subject: 'Úton a csomagod — átvételi kód: 548404', html: '<p>x</p>' });
      expect(capture).toHaveBeenCalledTimes(1);
      const extra = JSON.stringify(capture.mock.calls[0][1]?.extra || {});
      expect(extra, 'a 6 jegyű kód a Sentry-be ment').not.toContain('548404');
      expect(capture.mock.calls[0][1].extra).not.toHaveProperty('utolso_targy');
    } finally { teardown(); }
  });

  it('maskInText: csupasz 6 jegyű kód maszkolva, a 4 jegyű házszám/év nem', () => {
    expect(maskInText('kód: 548404, 2026, 1053 Budapest')).toBe('kód: ***, 2026, 1053 Budapest');
  });
});

describe('D1 — kívülálló és a már nem nyitott fuvar / értékelés-azonosító', () => {
  it('GET /jobs/:id: kívülálló elkelt fuvarra 404; aki ajánlatot tett, 200 (közelítő hely); nyitott fuvar 200', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const vesztes = await createUser({ role: 'carrier' });
    const kivul = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status) VALUES ($1, $2, 14000, 'rejected')`,
      [job.id, vesztes.id],
    );
    const k = await request(app).get(`/jobs/${job.id}`).set(auth(kivul.token));
    expect(k.status, 'UUID-val bárki megnézhette az elkelt fuvart (státusz, ár, feladó-azonosító)').toBe(404);
    const v = await request(app).get(`/jobs/${job.id}`).set(auth(vesztes.token));
    expect(v.status).toBe(200);
    expect(v.body.approximate_location).toBe(true);
    expect(v.body).not.toHaveProperty('paid_at');
    const nyitott = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const n = await request(app).get(`/jobs/${nyitott.id}`).set(auth(kivul.token));
    expect(n.status).toBe(200);
  });

  it('GET /reviews?user_id=: kívülálló nem kapja az értékelés job_id / booking_id-ját, a felek igen', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const kivul = await createUser();
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true });
    await db.query(
      `INSERT INTO reviews (job_id, reviewer_id, reviewee_id, stars, rating, comment)
       VALUES ($1, $2, $3, 5, 5, 'Gyors és pontos.')`,
      [job.id, shipper.id, carrier.id],
    );
    const k = await request(app).get(`/reviews?user_id=${carrier.id}`).set(auth(kivul.token));
    expect(k.status).toBe(200);
    const sor = k.body.find((r) => r.reviewer_id === shipper.id);
    expect(sor, 'az értékelés publikus, látszania kell').toBeTruthy();
    expect(sor, 'a fuvar azonosítója kívülállónak ment').not.toHaveProperty('job_id');
    expect(sor).not.toHaveProperty('booking_id');
    const f = await request(app).get(`/reviews?user_id=${carrier.id}`).set(auth(carrier.token));
    expect(f.body.find((r) => r.reviewer_id === shipper.id).job_id).toBe(job.id);
  });
});
