// =====================================================================
//  TELJES AUDIT — A2 csomag (2026-09-11): a pénz-út és a köré épült őrök
//   1. Webhook idempotencia-CLAIM az elején (párhuzamos ismétlés nem „árva").
//   2. Kézi nyugtázás a KÖZÖS magon: napló + számla + állapot-őr (409).
//   3. Ajánlói jutalom a fizetési NAPLÓRA épül, nem a paid_at-ra; plafon
//      a claim ELŐTT (halasztott, nem elvesző jutalom).
//   4. Díjmentes újraválasztás után nincs hamis „fizesd meg" felhívás.
//   5. Újranyitás nullázza az emlékeztető-számlálót.
//   6. Közelség-értesítés: párhuzamos pingekből EGY értesítés.
//   7. Vita: döntés-validáció + e-mail a másik félnek + admin-riasztás.
//   8. Admin PATCH /admin/users validált; a napló a 403 UTÁN.
//   9. Profil-mezők típus/hossz kapuja.
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob, createBooking, seenOffer } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const emailSzolgaltatas = require('../src/services/email');
const { maybeGrantReferralReward, REFERRAL_MONTHLY_CAP } = require('../src/services/referral');
const { grantVoucher } = require('../src/services/gamification');

const auth = (t) => ({ Authorization: `Bearer ${t}` });
const webhook = (body) => request(app).post('/payments/cib/callback').send(body);

async function varakozz(feltetel, ms = 4000) {
  const vege = Date.now() + ms;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await feltetel()) return true;
    if (Date.now() > vege) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 40));
  }
}
const ertesitesek = async (userId, tipus) => {
  const { rows } = await db.query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND type = $2', [userId, tipus],
  );
  return rows[0].n;
};
const naploSorok = async (paymentId) => (await db.query(
  'SELECT * FROM payment_events WHERE payment_id = $1', [paymentId],
)).rows;

async function fizetesreVaro() {
  __resetRateLimitsForTests();
  const felado = await createUser();
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false, priceHuf: 15000 });
  const paymentId = `teszt-a2-${job.id}`;
  await db.query(
    `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf)
     VALUES ($1, 500, 'held', $2, 0, 500)`,
    [job.id, paymentId],
  );
  await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
  return { felado, szallito, job, paymentId };
}

/** Versenyhelyzet-szimuláció: a handler ELSŐ, mintára illő SELECT-je után mutálunk. */
function kozbenAtir(minta, mutacio) {
  const eredeti = db.query;
  let megtortent = false;
  db.query = async (text, p) => {
    const r = await eredeti(text, p);
    if (!megtortent && minta.every((m) => m.test(String(text)))) {
      megtortent = true;
      await mutacio(eredeti);
    }
    return r;
  };
  return { vissza: () => { db.query = eredeti; }, megtortent: () => megtortent };
}

afterEach(() => { vi.restoreAllMocks(); });

// ─────────────────────────────────────────────────────────────────────
describe('1. webhook idempotencia-claim', () => {
  it('tíz párhuzamos Succeeded: egy napló-sor, webhook/processed, nem árva, egy számla', async () => {
    const { job, paymentId } = await fizetesreVaro();
    const valaszok = await Promise.all(
      Array.from({ length: 10 }, () => webhook({ PaymentId: paymentId, Status: 'Succeeded' })),
    );
    valaszok.forEach((r) => expect(r.status, JSON.stringify(r.body)).toBe(200));
    expect(valaszok.filter((r) => r.body.orphan).length, 'párhuzamos ismétlés „árvának" látta a SAJÁT ügyletét').toBe(0);
    expect(valaszok.filter((r) => !r.body.skipped).length, 'nem pontosan egy hívás dolgozta fel').toBe(1);
    const ev = await naploSorok(paymentId);
    expect(ev.length).toBe(1);
    expect(ev[0].processed).toBe(true);
    expect(ev[0].event_type, 'a napló-sor típusa felülíródott').toBe('webhook');
    expect(ev[0].summary).not.toMatch(/ÁRVA/);
    expect(Number(ev[0].platform_fee)).toBe(500);
    expect(ev[0].job_id).toBe(job.id);
    const { rows: szamlak } = await db.query(`SELECT 1 FROM invoices WHERE job_id = $1 AND status <> 'failed'`, [job.id]);
    expect(szamlak.length, 'több számla egy díjról').toBe(1);
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).not.toBeNull();
  });

  it('kivétel a feldolgozásban → a claim felszabadul, a PSP ismétlése könyvel (a claim-mechanizmus önvédő őre)', async () => {
    const { job, paymentId } = await fizetesreVaro();
    // Valódi DB-hiba a claim UTÁN: nem függ attól, hogy a könyvelés
    // pool.query-val vagy dedikált tranzakciós kapcsolaton olvas/ír.
    await db.query(`CREATE FUNCTION audit_claim_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'szimulált DB-kiesés'; END $$`);
    await db.query(`CREATE TRIGGER audit_claim_failure BEFORE UPDATE OF paid_at ON jobs
      FOR EACH ROW WHEN (NEW.id='${job.id}'::uuid AND NEW.paid_at IS NOT NULL)
      EXECUTE FUNCTION audit_claim_failure()`);
    let elso;
    try { elso = await webhook({ PaymentId: paymentId, Status: 'Succeeded' }); }
    finally { await db.query('DROP FUNCTION audit_claim_failure() CASCADE'); }
    expect(elso.status, 'a hibát 2xx-szel nyugtáztuk — a PSP nem ismételne').toBeGreaterThanOrEqual(500);
    expect((await naploSorok(paymentId)).filter((e) => !e.processed).length, 'processed=false claim maradt hátra — az ismétlés „feldolgozás alatt"-ként kiesne').toBe(0);
    const masodik = await webhook({ PaymentId: paymentId, Status: 'Succeeded' });
    expect(masodik.status).toBe(200);
    expect(masodik.body.skipped, 'az ismétlést kihagytuk, pedig az első elszállt').toBeUndefined();
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('2. kézi nyugtázás a közös magon', () => {
  it('fuvar: napló-sor (manual, processed, díj) + számla keletkezik', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false, priceHuf: 15000 });
    await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
    const res = await request(app).post(`/jobs/${job.id}/confirm-payment`).set(auth(felado.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows: ev } = await db.query('SELECT event_type, processed, platform_fee, shipper_id FROM payment_events WHERE job_id = $1', [job.id]);
    expect(ev.length, 'a kézi nyugtázás nem hagyott fizetési napló-sort').toBe(1);
    expect(ev[0].event_type).toBe('manual');
    expect(ev[0].processed).toBe(true);
    expect(Number(ev[0].platform_fee)).toBe(500);
    expect(ev[0].shipper_id).toBe(felado.id);
    const { rows: szamlak } = await db.query('SELECT 1 FROM invoices WHERE job_id = $1', [job.id]);
    expect(szamlak.length, 'a kézi nyugtázás nem állított ki számlát').toBe(1);
  });

  it('fuvar: a SELECT és az UPDATE közt lemondva → 409 STATE_CHANGED, paid_at marad NULL', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    await db.query('UPDATE jobs SET fee_consent_at = NOW() WHERE id = $1', [job.id]);
    const v = kozbenAtir([/FROM jobs j\b/, /WHERE j\.id = \$1/], (q) => q(
      `UPDATE jobs SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [job.id],
    ));
    let res;
    try { res = await request(app).post(`/jobs/${job.id}/confirm-payment`).set(auth(felado.token)).send({}); } finally { v.vissza(); }
    expect(v.megtortent()).toBe(true);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('STATE_CHANGED');
    const { rows } = await db.query('SELECT paid_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].paid_at, 'LEMONDOTT fuvar lett kézzel fizetetté').toBeNull();
  });

  it('foglalás: napló + számla; verseny → 409', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false });
    await db.query('UPDATE route_bookings SET fee_consent_at = NOW(), connection_fee_huf = 500 WHERE id = $1', [booking.id]);
    const res = await request(app).post(`/route-bookings/${booking.id}/confirm-payment`).set(auth(felado.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { rows: ev } = await db.query('SELECT event_type, processed, platform_fee FROM payment_events WHERE booking_id = $1', [booking.id]);
    expect(ev.length).toBe(1);
    expect(ev[0].event_type).toBe('manual');
    expect(Number(ev[0].platform_fee)).toBe(500);
    const { rows: szamlak } = await db.query('SELECT 1 FROM invoices WHERE booking_id = $1', [booking.id]);
    expect(szamlak.length).toBe(1);

    const { booking: b2 } = await createBooking({ shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: false });
    await db.query('UPDATE route_bookings SET fee_consent_at = NOW() WHERE id = $1', [b2.id]);
    const v = kozbenAtir([/FROM route_bookings b\b/, /WHERE b\.id = \$1/], (q) => q(
      `UPDATE route_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [b2.id],
    ));
    let r2;
    try { r2 = await request(app).post(`/route-bookings/${b2.id}/confirm-payment`).set(auth(felado.token)).send({}); } finally { v.vissza(); }
    expect(v.megtortent()).toBe(true);
    expect(r2.status, JSON.stringify(r2.body)).toBe(409);
    const { rows } = await db.query('SELECT paid_at FROM route_bookings WHERE id = $1', [b2.id]);
    expect(rows[0].paid_at).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('3. ajánlói jutalom: a fizetési napló a forrás', () => {
  async function paros() {
    const ajanlo = await createUser();
    const meghivott = await createUser();
    await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [ajanlo.id, meghivott.id]);
    return { ajanlo, meghivott };
  }
  const grantedAt = async (id) => (await db.query('SELECT referral_reward_granted_at FROM users WHERE id = $1', [id])).rows[0].referral_reward_granted_at;
  const kuponok = async (id) => (await db.query(`SELECT count(*)::int n FROM fee_vouchers WHERE user_id = $1 AND reason = 'referral'`, [id])).rows[0].n;
  const naploz = (meghivott, eventType = 'webhook', fee = 500) => db.query(
    `INSERT INTO payment_events (payment_id, status, event_type, processed, platform_fee, shipper_id)
     VALUES ($1, 'Succeeded', $2, true, $3, $4)`,
    [`ref-${meghivott.id}-${eventType}`, eventType, fee, meghivott.id],
  );

  it('paid_at + díj>0 a jobs-on, de KÖNYVELT fizetés nélkül → nincs jutalom', async () => {
    const { ajanlo, meghivott } = await paros();
    // kézi SQL-lel „fizetetté" tett fuvar: paid_at + díj>0, de a fizetési naplóban semmi
    const job = await createJob({ shipperId: meghivott.id, status: 'accepted', paid: false });
    await db.query('UPDATE jobs SET paid_at = NOW(), connection_fee_huf = 500 WHERE id = $1', [job.id]);
    await maybeGrantReferralReward(meghivott.id, { role: 'shipper', jobId: job.id });
    expect(await grantedAt(meghivott.id), 'a paid_at oszlop önmagában jutalmat termelt (kézi SQL / régi csupasz nyugtázás is beállítja)').toBeNull();
    expect(await kuponok(ajanlo.id)).toBe(0);
  });

  it('könyvelt webhook-fizetéssel jár; árva fizetéssel nem', async () => {
    const a = await paros();
    await naploz(a.meghivott, 'orphan');
    await maybeGrantReferralReward(a.meghivott.id, { role: 'shipper', jobId: null });
    expect(await grantedAt(a.meghivott.id), 'az ÁRVA (visszatérítendő) fizetés jutalmat termelt').toBeNull();

    const b = await paros();
    await naploz(b.meghivott, 'webhook');
    await maybeGrantReferralReward(b.meghivott.id, { role: 'shipper', jobId: null });
    expect(await grantedAt(b.meghivott.id)).not.toBeNull();
    expect(await kuponok(b.ajanlo.id)).toBe(1);
  });

  it('betelt havi plafon: a meghívott JELÖLETLEN marad (halasztott jutalom, nem elvesző)', async () => {
    const { ajanlo, meghivott } = await paros();
    for (let i = 0; i < REFERRAL_MONTHLY_CAP; i++) await grantVoucher(ajanlo.id, 'referral', 30, null); // eslint-disable-line no-await-in-loop
    // fizetett fuvar + könyvelt díj: a régi (paid_at-alapú) ÉS az új (napló-alapú) őr is átengedi —
    // így a teszt CSAK a plafon/claim sorrendet méri (a régi sorrenddel piros)
    await createJob({ shipperId: meghivott.id, status: 'accepted', paid: true });
    await naploz(meghivott, 'webhook');
    await maybeGrantReferralReward(meghivott.id, { role: 'shipper', jobId: null });
    expect(await grantedAt(meghivott.id), 'a plafon miatt kimaradt jutalom VÉGLEG elveszett (a meghívott „granted" lett kupon nélkül)').toBeNull();
    expect(await kuponok(ajanlo.id)).toBe(REFERRAL_MONTHLY_CAP);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('4. díjmentes újraválasztás: nincs hamis fizetési felhívás', () => {
  it('szállító-csere után az új elfogadás nem küld payment_due-t, a szállító „már rendezve"-t kap', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const elso = await createUser({ role: 'carrier' });
    const masodik = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: elso.id, status: 'accepted', paid: true });
    const cancel = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(elso.token)).send({ reason: 'nem érek rá' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const { rows: bid } = await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy) VALUES ($1, $2, 60000, 'pending', 'included') RETURNING id`,
      [job.id, masodik.id],
    );
    const acc = await request(app).post(`/bids/${bid[0].id}/accept`).send(await seenOffer(bid[0].id)).set(auth(felado.token));
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.fee_already_paid).toBe(true);
    expect(await varakozz(async () => (await ertesitesek(masodik.id, 'bid_accepted')) === 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 150));
    expect(await ertesitesek(felado.id, 'payment_due'), 'a feladót fizetésre szólítottuk, pedig a díj már rendezve').toBe(0);
    expect(await ertesitesek(felado.id, 'deal_closed')).toBe(1);
    const { rows } = await db.query(`SELECT body FROM notifications WHERE user_id = $1 AND type = 'bid_accepted'`, [masodik.id]);
    expect(rows[0].body).toMatch(/már rendezve/);
    expect(rows[0].body).not.toMatch(/most fizeti/);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('5. újranyitás nullázza az emlékeztető-számlálót', () => {
  it('2× sürgetett, fizetetlen fuvar szállító-csere után újra kaphat emlékeztetőt', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    await db.query('UPDATE jobs SET payment_reminder_count = 2, last_payment_reminder_at = NOW() WHERE id = $1', [job.id]);
    const cancel = await request(app).post(`/jobs/${job.id}/cancel`).set(auth(szallito.token)).send({ reason: 'nem érek rá' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    const { rows } = await db.query('SELECT status, payment_reminder_count, last_payment_reminder_at FROM jobs WHERE id = $1', [job.id]);
    expect(rows[0].status).toBe('bidding');
    expect(rows[0].payment_reminder_count, 'az emlékeztető-számláló nem nullázódott — az új megállapodás sosem kap sürgetést').toBe(0);
    expect(rows[0].last_payment_reminder_at).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('6. közelség-értesítés idempotens', () => {
  it('három párhuzamos ping a célváros határán → EGY „beért a városba" értesítés', async () => {
    __resetRateLimitsForTests();
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'in_progress', paid: true });
    const KOZEL_2KM = { lat: 46.2710, lng: 20.1414 };
    await Promise.all([1, 2, 3].map(() => request(app).post(`/jobs/${job.id}/location`).set(auth(carrier.token)).send(KOZEL_2KM)));
    expect(await varakozz(async () => (await ertesitesek(shipper.id, 'driver_entering_city')) >= 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(await ertesitesek(shipper.id, 'driver_entering_city'), 'párhuzamos pingekből TÖBB „beért a városba" értesítés ment').toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('7. vita: döntés-validáció + e-mail + admin-riasztás', () => {
  async function nyitottVita() {
    __resetRateLimitsForTests();
    const felado = await createUser();
    const szallito = await createUser({ role: 'carrier' });
    const admin = await createUser({ role: 'admin' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true });
    const res = await request(app).post('/disputes').set(auth(felado.token)).send({ job_id: job.id, description: 'Sérült csomag érkezett.' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return { felado, szallito, admin, job, vita: res.body };
  }
  const patch = (token, id, body) => request(app).patch(`/disputes/${id}`).set(auth(token)).send(body);

  it('resolved_* indoklás nélkül 400; hibás refund_huf 400; nem-szöveg indoklás 400; a vita marad nyitva', async () => {
    const { admin, vita } = await nyitottVita();
    const esetek = [
      [{ status: 'resolved_no_action' }, 'RESOLUTION_NOTE_REQUIRED'],
      [{ status: 'resolved_refund', resolution_note: '   ' }, 'RESOLUTION_NOTE_REQUIRED'],
      [{ status: 'resolved_partial', resolution_note: 'ok', refund_huf: 'abc' }, 'REFUND_INVALID'],
      [{ status: 'resolved_partial', resolution_note: 'ok', refund_huf: -5 }, 'REFUND_INVALID'],
      [{ status: 'resolved_partial', resolution_note: 'ok', refund_huf: 1.5 }, 'REFUND_INVALID'],
      [{ status: 'under_review', resolution_note: 123 }, 'RESOLUTION_NOTE_INVALID'],
      [{ status: 'under_review', resolution_note: 'x'.repeat(2001) }, 'RESOLUTION_NOTE_INVALID'],
    ];
    for (const [body, kod] of esetek) {
      // eslint-disable-next-line no-await-in-loop
      const r = await patch(admin.token, vita.id, body);
      expect(r.status, `${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.body)}`).toBe(400);
      expect(r.body.code).toBe(kod);
    }
    const { rows } = await db.query('SELECT status FROM disputes WHERE id = $1', [vita.id]);
    expect(rows[0].status).toBe('open');
    const jo = await patch(admin.token, vita.id, { status: 'resolved_partial', resolution_note: 'Részleges megegyezés.', refund_huf: '1500' });
    expect(jo.status, JSON.stringify(jo.body)).toBe(200);
    expect(Number(jo.body.refund_huf)).toBe(1500);
  });

  it('vita-nyitás: e-mail a másik félnek + riasztás az adminnak (in-app + panasz@)', async () => {
    const levelek = [];
    vi.spyOn(emailSzolgaltatas, 'sendEmail').mockImplementation(async (opts) => { levelek.push(opts); return { stub: true }; });
    const { szallito, vita } = await nyitottVita();
    expect(await varakozz(async () => levelek.length >= 2), `csak ${levelek.length} levél ment ki vita-nyitáskor`).toBe(true);
    expect(levelek.some((l) => l.to === szallito.email), 'a másik fél nem kapott e-mailt a vitáról').toBe(true);
    expect(levelek.some((l) => l.to === 'panasz@gofuvar.hu'), 'az admin nem kapott riasztó e-mailt').toBe(true);
    expect(levelek.every((l) => !/Sérült csomag/.test(l.html || '')), 'a vita leírása (PII-gyanús szabad szöveg) az e-mailbe került').toBe(true);
    // A teszt-DB-ben sok admin él (más tesztfájlokból), a LIMIT 10 nem biztos, hogy a
    // miénket éri el — az számít, hogy VALAMELYIK admin megkapta ezt a vitát.
    const adminRiasztas = async () => (await db.query(
      `SELECT 1 FROM notifications WHERE type = 'admin_dispute_opened' AND body LIKE '%' || $1 || '%'`, [vita.id],
    )).rows.length;
    expect(await varakozz(async () => (await adminRiasztas()) >= 1), 'egyetlen admin sem kapott in-app riasztást').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('8. admin: PATCH /admin/users validáció + napló a 403 után', () => {
  it('érvénytelen értékek 400-at kapnak (nem 500 a DB-CHECK-en, nem néma elfogadás)', async () => {
    __resetRateLimitsForTests();
    const admin = await createUser({ role: 'admin' });
    const cel = await createUser();
    const rosszak = [
      { identity_kyc_status: 'lol' }, { driver_kyc_status: 'ok' }, { company_verification_status: 1 },
      { can_bid: 'igen' }, { trust_score: 'abc' }, { trust_score: 101 }, { trust_score: 1.5 }, { level: 99 }, { level: 0 },
    ];
    for (const body of rosszak) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).patch(`/admin/users/${cel.id}`).set(auth(admin.token)).send(body);
      expect(r.status, `${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.body)}`).toBe(400);
    }
    const jo = await request(app).patch(`/admin/users/${cel.id}`).set(auth(admin.token)).send({ trust_score: 50, can_bid: false, level: 2 });
    expect(jo.status, JSON.stringify(jo.body)).toBe(200);
  });

  it('nem-admin a fizetési naplón: 403, és NEM kerül admin-napló sor a nevére', async () => {
    const felado = await createUser();
    const r = await request(app).get('/payments/admin/log').set(auth(felado.token));
    expect(r.status).toBe(403);
    const { rows } = await db.query(`SELECT 1 FROM admin_access_log WHERE admin_id = $1 AND action = 'payment_log'`, [felado.id]);
    expect(rows.length, 'a nem-admin 403-as próbálkozása „payment_log hozzáférés"-ként naplózódott').toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('9. profil-mezők típus/hossz kapuja', () => {
  it('tömb bio, 300 karakteres cégnév, rossz EU-adószám → 400; jó érték normalizálva mentődik', async () => {
    __resetRateLimitsForTests();
    const u = await createUser();
    const rosszak = [
      { bio: ['x'] }, { company_name: 'a'.repeat(300) }, { eu_vat_number: 'xx' }, { eu_vat_number: 'HU-1234' },
      { billing_address: { utca: 'x' } }, { vehicle_type: 'v'.repeat(101) }, { company_reg_number: 'c'.repeat(41) },
    ];
    for (const body of rosszak) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request(app).patch('/auth/me').set(auth(u.token)).send(body);
      expect(r.status, `${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.body)}`).toBe(400);
    }
    const jo = await request(app).patch('/auth/me').set(auth(u.token)).send({ eu_vat_number: 'hu 12345678', vehicle_type: '  Furgon ' });
    expect(jo.status, JSON.stringify(jo.body)).toBe(200);
    const { rows } = await db.query('SELECT eu_vat_number, vehicle_type FROM users WHERE id = $1', [u.id]);
    expect(rows[0].eu_vat_number).toBe('HU12345678');
    expect(rows[0].vehicle_type).toBe('Furgon');
  });
});
