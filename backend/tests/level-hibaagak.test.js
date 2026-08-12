// =====================================================================
//  TRANZAKCIÓS LEVELEK: HIBAÁGAK, MASZKOLÁS, HTML-INJEKTÁLÁS (2026-08-12)
//
//  ⚠️ 67%-OS ELÁGAZÁS-LEFEDETTSÉGEN ÁLLT — a fedetlen rész pedig a hibaágakon
//  és a jogi tartalmon volt. Ez a modul EGYSZERRE három garanciát hordoz:
//
//   1. BIZTONSÁGI: minden felhasználó-vezérelt érték escape-elve megy a
//      levél HTML-törzsébe. Enélkül egy szállító a saját NEVÉBE tett linkkel
//      GoFuvar-arculatú, noreply@gofuvar.hu-ról érkező phishing-levelet
//      küldethet a feladónak és a címzettnek (2026-08-10 audit).
//   2. ADATVÉDELMI: a Railway-logba SOHA nem kerülhet teljes e-mail-cím,
//      telefonszám vagy levéltörzs (az átvételi kódot és a követő-linket
//      tartalmazza). A Resend VISSZHANGOZZA a címzettet a 4xx-válaszaiban —
//      egyetlen kilógó log-sor volt, és az kiszivárogtatta (2026-08-11).
//   3. JOGI: a díj-visszaigazoló levél a 45/2014. Korm. r. 18. §-a szerinti
//      TARTÓS ADATHORDOZÓS visszaigazolás, benne a 29. § (1) a) szerinti
//      nyilatkozattal. Ha ez a szöveg kiesik, az jogsértés — semmilyen teszt
//      nem őrizte eddig.
//
//  ⚠️ SOHA NEM MEGY KI VALÓDI LEVÉL: a `global.fetch` minden tesztben mockolt,
//  és a fájl végén külön teszt bizonyítja, hogy a Resend-hez nem ment kérés
//  ott, ahol nem is szabadott volna.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, afterAll, vi,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const email = require('../src/services/email');

const EREDETI_KULCS = process.env.RESEND_API_KEY;
const EREDETI_FROM = process.env.EMAIL_FROM;

/** A Resend felé indított kérések. */
let kimeno;
/** A konzolra írt sorok (log + warn + error összefűzve). */
let naplo;

function resendValaszol({ ok = true, status = 200, json = { id: 're_123' }, text = '' } = {}) {
  vi.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
    kimeno.push({ url: String(url), opts, body: JSON.parse(opts?.body || '{}') });
    return {
      ok, status, json: async () => json, text: async () => text,
    };
  });
}

beforeEach(() => {
  kimeno = [];
  naplo = [];
  for (const szint of ['log', 'warn', 'error']) {
    vi.spyOn(console, szint).mockImplementation((...a) => {
      naplo.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
    });
  }
});

afterEach(() => { vi.restoreAllMocks(); });

afterAll(() => {
  if (EREDETI_KULCS === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = EREDETI_KULCS;
  if (EREDETI_FROM === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = EREDETI_FROM;
});

/** Éles (nem stub) mód egy teszt idejére. */
function elesKulccsal() {
  process.env.RESEND_API_KEY = 're_teszt_kulcs_nem_eles';
}
afterEach(() => { process.env.RESEND_API_KEY = EREDETI_KULCS ?? ''; });

// =====================================================================
//  1) A NYERS KÜLDÉS HIBAÁGAI
// =====================================================================
describe('sendEmail — hibaágak', () => {
  it('hiányos adatnál nem indít kérést, és nem is dob', async () => {
    elesKulccsal();
    resendValaszol();
    for (const opts of [
      {}, { to: 'a@b.hu' }, { to: 'a@b.hu', subject: 'x' },
      { subject: 'x', html: '<p>x</p>' }, { to: '', subject: 'x', html: 'y' },
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await email.sendEmail(opts);
      expect(r, `a(z) ${JSON.stringify(opts)} hiányos adatra nem null jött vissza`).toBeNull();
    }
    expect(
      kimeno,
      'HIÁNYOS ADATTAL IS KIHÍVTUNK A RESEND-HEZ. Minden ilyen kérés 4xx-et '
      + 'kap, ami kvótát éget és hamis riasztásokat szül a logban.',
    ).toEqual([]);
  });

  it('a hiányos adat naplózásában sincs teljes e-mail-cím', async () => {
    await email.sendEmail({ to: 'gyanutlan.felado@gmail.com', subject: 'x' });
    expect(
      naplo.join('\n'),
      'A TELJES E-MAIL-CÍM A NAPLÓBA KERÜLT. A Railway-log nem lehet '
      + 'címlista-forrás — a modul minden más sora maszkol.',
    ).not.toContain('gyanutlan.felado@gmail.com');
    expect(naplo.join('\n'), 'a maszkolt alak sem jelent meg').toContain('g***@gmail.com');
  });

  it('STUB módban (kulcs nélkül) nem hív ki, de sikert jelez', async () => {
    process.env.RESEND_API_KEY = '';
    const hivas = vi.spyOn(global, 'fetch');
    const r = await email.sendEmail({ to: 'a@b.hu', subject: 'Tárgy', html: '<p>x</p>' });
    expect(r.stub, 'stub módban nem stubként viselkedett').toBe(true);
    expect(hivas, 'STUB módban is kihívtunk a Resend-hez (valódi levél ment volna ki)').not.toHaveBeenCalled();
  });

  it('a STUB-napló nem tartalmazza a levél TÖRZSÉT (átvételi kód, követő link)', async () => {
    process.env.RESEND_API_KEY = '';
    await email.sendEmail({
      to: 'cimzett@example.com',
      subject: 'Csomag érkezik',
      html: '<p>Átvételi kód: 481516</p><a href="https://gofuvar.hu/nyomon-kovetes/abc123token">követés</a>',
    });
    const szoveg = naplo.join('\n');
    expect(
      szoveg,
      'AZ ÁTVÉTELI KÓD A NAPLÓBA KERÜLT. A kód a fuvar lezárásának kulcsa — '
      + 'aki hozzáfér a loghoz, átvehetné a csomagot.',
    ).not.toContain('481516');
    expect(szoveg, 'a követő-token a naplóba került').not.toContain('abc123token');
    expect(szoveg, 'a teljes címzett-cím a naplóba került').not.toContain('cimzett@example.com');
  });

  it('sikeres küldésnél a helyes API-t, fejlécet és törzset küldjük', async () => {
    elesKulccsal();
    process.env.EMAIL_FROM = 'GoFuvar <noreply@gofuvar.hu>';
    resendValaszol({ json: { id: 're_abc' } });

    const r = await email.sendEmail({ to: 'a@b.hu', subject: 'Tárgy', html: '<p>Hello <b>vilag</b></p>' });
    expect(r).toEqual({ stub: false, id: 're_abc' });
    expect(kimeno.length, 'nem indult Resend-kérés').toBe(1);
    expect(kimeno[0].url).toBe('https://api.resend.com/emails');
    expect(
      kimeno[0].opts.headers.Authorization,
      'az API-kulcs nem Bearer fejlécként ment — a Resend 401-et adna, és MINDEN '
      + 'levél némán kiesne',
    ).toBe('Bearer re_teszt_kulcs_nem_eles');
    expect(kimeno[0].body.from).toBe('GoFuvar <noreply@gofuvar.hu>');
    expect(kimeno[0].body.to).toEqual(['a@b.hu']);
    expect(
      kimeno[0].body.text,
      'a plain-text változatban HTML-tagek maradtak — a szöveges kliensek '
      + '(és a spam-szűrők) nyers markupot látnának',
    ).not.toMatch(/<[a-z]/i);
    expect(kimeno[0].body.text).toContain('Hello');
  });

  it('EMAIL_FROM nélkül a resend.dev feladóra esik (amit a Resend 403-mal dob el)', async () => {
    elesKulccsal();
    delete process.env.EMAIL_FROM;
    resendValaszol();
    await email.sendEmail({ to: 'a@b.hu', subject: 'x', html: '<p>x</p>' });
    expect(
      kimeno[0].body.from,
      'a feladó-fallback megváltozott — ha ez üres/undefined lenne, a Resend '
      + 'minden levelet eldobna, és a hiba csak élesben derülne ki',
    ).toContain('resend.dev');
  });

  it('Resend-hibaválasznál null-t ad, és a visszhangzott PII MASZKOLVA kerül a logba', async () => {
    elesKulccsal();
    // A Resend a 4xx-válaszban visszhangozza a beküldött adatot.
    resendValaszol({
      ok: false,
      status: 422,
      text: '{"statusCode":422,"message":"Invalid `to` field: gyanutlan.cimzett@gmail.com, '
        + 'phone in body: +36 30 123 4567"}',
    });
    const r = await email.sendEmail({ to: 'gyanutlan.cimzett@gmail.com', subject: 'x', html: '<p>x</p>' });
    expect(r, 'a Resend-hibából nem null lett — a hívó sikeresnek hinné a küldést').toBeNull();

    const szoveg = naplo.join('\n');
    expect(
      szoveg,
      'A RESEND ÁLTAL VISSZHANGZOTT E-MAIL-CÍM MASZKOLATLANUL A LOGBA KERÜLT.\n\n'
      + 'Pontosan ez volt a 2026-08-11-i adatáramlási audit találata: ennek a '
      + 'fájlnak MINDEN más log-sora maszkol, ez az egy nem.',
    ).not.toContain('gyanutlan.cimzett@gmail.com');
    expect(
      szoveg,
      'a hibaválaszban visszhangzott TELEFONSZÁM maszkolatlanul a logba került',
    ).not.toContain('+36 30 123 4567');
    expect(szoveg, 'a HTTP-státusz elveszett a logból — enélkül nem debuggolható').toContain('422');
  });

  it('hálózati hibánál sem dob (a fizetés-nyugtázás nem fordulhat meg egy levéltől)', async () => {
    elesKulccsal();
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      email.sendEmail({ to: 'a@b.hu', subject: 'x', html: '<p>x</p>' }),
      'A LEVÉLKÜLDÉS KIDOBTA A HÁLÓZATI HIBÁT. Ez a függvény a fizetési '
      + 'webhookból is fut — egy Resend-kiesés visszafordítaná a díj-nyugtázást.',
    ).resolves.toBeNull();
  });

  it('értelmezhetetlen Resend-válaszra (nem JSON) sem dob', async () => {
    elesKulccsal();
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); },
    });
    await expect(email.sendEmail({ to: 'a@b.hu', subject: 'x', html: '<p>x</p>' })).resolves.toBeNull();
  });

  it('id nélküli válaszból is érvényes eredmény lesz', async () => {
    elesKulccsal();
    resendValaszol({ json: {} });
    expect(await email.sendEmail({ to: 'a@b.hu', subject: 'x', html: '<p>x</p>' }))
      .toEqual({ stub: false, id: null });
  });

  it('isStub() a kulcs meglétét tükrözi', () => {
    process.env.RESEND_API_KEY = '';
    expect(email.isStub()).toBe(true);
    elesKulccsal();
    expect(
      email.isStub(),
      'beállított kulccsal is stub-módot jelentettünk — élesben egyetlen levél '
      + 'sem menne ki, és semmi nem szólna',
    ).toBe(false);
  });
});

// =====================================================================
//  2) ESCAPE + SABLON-VÁZ
// =====================================================================
describe('escapeHtml és wrapHtml', () => {
  it('minden HTML-jelentésű karaktert escape-el', () => {
    expect(email.escapeHtml('<script>alert(1)</script>'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(
      email.escapeHtml(`" onmouseover='x' &`),
      'az aposztróf vagy az idézőjel escape-elése kimaradt — attribútumból ki '
      + 'lehetne törni (pl. href="..." onmouseover=...)',
    ).toBe('&quot; onmouseover=&#39;x&#39; &amp;');
    expect(email.escapeHtml('&lt;'), 'az & nem elsőként escape-elődik → dupla escape').toBe('&amp;lt;');
  });

  it('null/undefined-ból üres string lesz (nem „undefined" a levélben)', () => {
    expect(email.escapeHtml(null)).toBe('');
    expect(email.escapeHtml(undefined)).toBe('');
    expect(email.escapeHtml(0), 'a 0-ból üres string lett — a nulla érvényes érték').toBe('0');
  });

  it('a CTA-gomb csak teljes konfigurációval jelenik meg', () => {
    const teljes = email.wrapHtml({ heading: 'H', bodyHtml: '<p>b</p>', ctaText: 'Kattints', ctaHref: 'https://gofuvar.hu/x' });
    expect(teljes).toContain('Kattints');
    expect(teljes).toContain('https://gofuvar.hu/x');

    for (const fel of [
      { ctaText: 'Kattints' }, { ctaHref: 'https://gofuvar.hu/x' }, {},
    ]) {
      const html = email.wrapHtml({ heading: 'H', bodyHtml: '<p>b</p>', ...fel });
      expect(
        /border-radius:8px;text-decoration:none/.test(html),
        `a(z) ${JSON.stringify(fel)} fél-konfigurációból is gomb lett — üres `
        + 'vagy szöveg nélküli gomb kerülne a levélbe',
      ).toBe(false);
    }
  });

  it('minden levél lábléce megnevezi az adatkezelőt és linkeli a tájékoztatót', () => {
    const html = email.wrapHtml({ heading: 'H', bodyHtml: '<p>b</p>' });
    expect(html, 'az adatkezelő megnevezése kiesett a lábléc-sablonból').toContain('Tiszta Hód Kft.');
    expect(html).toContain('/adatkezeles');
  });

  it('a címzetti tájékoztató blokk a GDPR 14. cikk kötelező elemeit tartalmazza', () => {
    const blokk = email.cimzettiTajekoztatoBlokk();
    // A címzett NEM felhasználónk: nem adott adatot, semmit nem fogadott el.
    expect(blokk, 'hiányzik: honnan van az adata (a feladó adta meg)').toMatch(/feladó(ja)? adta meg/);
    expect(blokk, 'hiányzik az adatkezelő megnevezése').toContain('Tiszta Hód Kft.');
    expect(blokk, 'hiányzik a megőrzési idő').toMatch(/3 éven belül töröljük/);
    expect(blokk, 'hiányzik a tiltakozási/kapcsolatfelvételi lehetőség').toContain('info@gofuvar.hu');
  });
});

// =====================================================================
//  3) HTML-INJEKTÁLÁS — OSZTÁLY-TESZT MINDEN SABLONRA
// =====================================================================
//
// A támadó a saját PROFILNEVÉBE (vagy egy fuvar címébe) teszi a payloadot.
// A levél a MÁSIK félnek megy, GoFuvar-arculattal, noreply@gofuvar.hu-ról —
// ez a legmeggyőzőbb phishing-felület, ami a platformon létezhet.
const MERGEZETT = '<a href="https://csalo.example/fizetes">Kattints a fizetéshez</a>';

/**
 * Sablon → a FELHASZNÁLÓ-VEZÉRELT mezői.
 *
 * ⚠️ Ami NINCS a listán, azt a `leltar-őr` teszt kifogásolja. Az URL-mezők
 * (verifyUrl, resetUrl, trackingUrl, detailsPath) SZÁNDÉKOSAN nincsenek itt:
 * azokat a szerver állítja elő, felhasználói bemenet sosem kerül beléjük.
 */
const SABLONOK = {
  sendBidReceivedEmail: ['shipperName', 'jobTitle', 'carrierName'],
  sendLaneAlertEmail: ['carrierName', 'jobTitle', 'routeLabel'],
  sendBidAcceptedEmail: ['carrierName', 'jobTitle'],
  sendJobPaidEmail: ['carrierName', 'jobTitle', 'shipperName'],
  sendFeeConfirmationEmail: ['shipperName', 'jobTitle'],
  sendBookingReceivedEmail: ['carrierName', 'routeTitle', 'shipperName'],
  sendBookingConfirmedEmail: ['shipperName', 'routeTitle', 'carrierName'],
  sendBookingPaidEmail: ['carrierName', 'routeTitle', 'shipperName'],
  sendBookingRejectedEmail: ['shipperName', 'routeTitle'],
  sendCancellationEmail: ['recipientName', 'jobTitle'],
  sendRecipientTrackingEmail: ['recipientName', 'jobTitle', 'deliveryCode'],
  sendEmailVerificationEmail: ['fullName'],
  sendPasswordResetEmail: ['fullName'],
  sendTaxDataRequestEmail: ['name'],
  sendAdminMessageEmail: ['name', 'bodyText'],
  sendPaymentDueEmail: ['shipperName', 'jobTitle'],
  sendDormantAccountWarningEmail: ['name'],
};

/** Nem sablon-küldők (nyers API vagy segédfüggvény) — indoklással. */
const NEM_SABLON = {
  sendEmail: 'a nyers küldő; a hívója felel az escape-elésért (a sablonok mind escape-elnek)',
};

describe('HTML-injektálás: minden sablon escape-el', () => {
  for (const [nev, mezok] of Object.entries(SABLONOK)) {
    for (const mezo of mezok) {
      it(`${nev} — a(z) "${mezo}" mező nem tehet linket a levélbe`, async () => {
        const kuldott = [await level(nev, { [mezo]: MERGEZETT })];

        expect(kuldott.length, `${nev}: nem indult levélküldés`).toBe(1);
        expect(
          kuldott[0].html,
          `A(Z) ${nev} SABLONBAN A "${mezo}" MEZŐ NYERSEN BEKERÜL A HTML-BE.\n\n`
          + 'Egy felhasználó a saját nevébe (vagy a fuvar címébe) tett linkkel '
          + 'GoFuvar-arculatú, noreply@gofuvar.hu-ról érkező phishing-levelet '
          + 'küldethet a másik félnek. Használd az escapeHtml()-t.',
        ).not.toContain('<a href="https://csalo.example/fizetes">');
        expect(
          kuldott[0].html,
          `${nev}: a "${mezo}" mező tartalma egyáltalán nem jelent meg a levélben `
          + '(sem nyersen, sem escape-elve) — a teszt így semmit nem bizonyít',
        ).toContain('csalo.example');
      });
    }
  }

  it('LELTÁR-ŐR: minden exportált levél-sablon szerepel a mátrixban', () => {
    const exportaltak = Object.keys(email).filter((k) => /^send[A-Z].*Email$/.test(k));
    const hianyzo = exportaltak.filter((k) => !(k in SABLONOK) && !(k in NEM_SABLON));
    expect(
      hianyzo,
      'ÚJ LEVÉL-SABLON KERÜLT A MODULBA, AMIT AZ INJEKTÁLÁS-MÁTRIX NEM FED.\n\n'
      + `Vedd fel a SABLONOK térképbe a felhasználó-vezérelt mezőivel:\n`
      + hianyzo.map((k) => `  ${k}: ['nev', 'cim'],`).join('\n')
      + '\n\n(Vagy a NEM_SABLON listába, ÍRÁSOS indoklással.)',
    ).toEqual([]);

    // A lista elavulása is hiba: törölt sablon ne maradjon bent.
    const felesleges = [...Object.keys(SABLONOK), ...Object.keys(NEM_SABLON)]
      .filter((k) => typeof email[k] !== 'function');
    expect(felesleges, 'a mátrix már nem létező sablonokra hivatkozik').toEqual([]);
  });
});

// =====================================================================
//  4) A SABLONOK ÜZLETI / JOGI TARTALMA
// =====================================================================
/**
 * A KÉSZ, kimenő levelet adja vissza.
 *
 * ⚠️ A `sendEmail`-t NEM lehet a modul-objektumon kimockolni: a sablonok a
 * modulon BELÜLI függvény-hivatkozást hívják, nem a `module.exports`-ot.
 * (Az első változatom pontosan ezen bukott el — 37 teszt „nem indult
 * levélküldés"-sel hasalt el.) Ezért a HÁLÓZATI RÉTEGET fogjuk el: így
 * azt látjuk, ami TÉNYLEG kimenne a Resend-nek.
 */
async function level(nev, args) {
  elesKulccsal();
  kimeno = [];
  resendValaszol();
  await email[nev]({ to: 'a@b.hu', ...args });
  vi.restoreAllMocks();
  return kimeno[kimeno.length - 1]?.body;
}

describe('Névtelen felhasználó megszólítása', () => {
  it('hiányzó név esetén sem lesz „Szia !" vagy „Szia undefined!"', async () => {
    for (const [nev, mezo] of [
      ['sendBidReceivedEmail', 'shipperName'],
      ['sendBidAcceptedEmail', 'carrierName'],
      ['sendPasswordResetEmail', 'fullName'],
      ['sendEmailVerificationEmail', 'fullName'],
      ['sendTaxDataRequestEmail', 'name'],
      ['sendDormantAccountWarningEmail', 'name'],
      ['sendAdminMessageEmail', 'name'],
    ]) {
      // eslint-disable-next-line no-await-in-loop
      const l = await level(nev, { [mezo]: null, jobTitle: 'Fuvar', bodyText: 'x' });
      expect(
        l.html,
        `${nev}: hiányzó névnél „undefined"/„null" került a megszólításba`,
      ).not.toMatch(/Szia (undefined|null)/);
      expect(l.html, `${nev}: üres megszólítás („Szia !")`).not.toMatch(/Szia !/);
      expect(
        l.html,
        `${nev}: hiányzó névnél nem lépett be az általános megszólítás`,
      ).toMatch(/Szia GoFuvar (felhasználó|szállító)!/);
    }
  });

  it('a Ft-összegek tagolva jelennek meg, a hiányzó összeg 0', async () => {
    const l = await level('sendBidReceivedEmail', { carrierName: 'X', jobTitle: 'Y', amountHuf: 1234567 });
    expect(
      l.html,
      'az összeg tagolatlanul jelenik meg — „1234567 Ft" olvashatatlan',
    ).not.toContain('1234567 Ft');
    expect(l.html).toMatch(/1.234.567/);

    const nulla = await level('sendBookingPaidEmail', { carrierName: 'X', routeTitle: 'Y' });
    expect(nulla.html, 'hiányzó összegnél „undefined Ft" került a levélbe').not.toMatch(/undefined|NaN/);
  });
});

describe('Díj-visszaigazolás (45/2014. Korm. r. 18. §) — jogi tartalom', () => {
  it('tartalmazza a fogyasztói nyilatkozatot és a megfizetett díjat', async () => {
    const l = await level('sendFeeConfirmationEmail', {
      shipperName: 'Kovács Anna', jobTitle: 'Bútor Szegedre', feeHuf: 1000,
      paidAtIso: '2026-08-12T10:00:00.000Z',
    });
    expect(
      l.html,
      'A DÍJ-VISSZAIGAZOLÓ LEVÉLBŐL KIESETT A 29. § (1) a) SZERINTI '
      + 'NYILATKOZAT SZÖVEGE.\n\n'
      + 'Ez a levél a szerződés tartós adathordozós visszaigazolása. A '
      + 'nyilatkozat nélkül a „nem visszatérítendő díj" nem érvényesíthető, '
      + 'és a fogyasztó elállási joga fennmarad.',
    ).toMatch(/45\/2014.*29\. § \(1\) a\)/s);
    expect(l.html, 'hiányzik az azonnali teljesítés kérése').toMatch(/azonnali teljesítés/);
    expect(l.html, 'hiányzik a megfizetett díj összege').toMatch(/1\D?000 Ft/);
    expect(l.subject, 'a tárgysorból nem derül ki, hogy díj-visszaigazolásról van szó').toMatch(/visszaigazolás/i);
  });

  it('a díjmentes szállító-csere lehetőségét is közli (ÁSZF 4./6.)', async () => {
    const l = await level('sendFeeConfirmationEmail', { jobTitle: 'X', feeHuf: 500 });
    expect(
      l.html,
      'kimaradt, hogy szállító-meghiúsulásnál díjmentesen választható másik '
      + 'szállító — ez a „nem visszatérítendő" díj ellentételezése',
    ).toMatch(/díjmentesen választhatsz másik szállítót/);
  });

  it('készpénzes fuvardíj csak akkor szerepel, ha van összeg', async () => {
    const van = await level('sendFeeConfirmationEmail', { jobTitle: 'X', feeHuf: 500, cashHuf: 15000 });
    expect(van.html, 'a készpénzes emlékeztető kimaradt').toMatch(/készpénzben/);
    expect(van.html).toMatch(/15\D?000 Ft/);

    const nincs = await level('sendFeeConfirmationEmail', { jobTitle: 'X', feeHuf: 500 });
    expect(
      /15\D?000/.test(nincs.html),
      'összeg nélkül is megjelent egy fuvardíj-blokk',
    ).toBe(false);
  });

  it('fizetési időpont nélkül a mostani időt írja (a mező sosem üres)', async () => {
    const l = await level('sendFeeConfirmationEmail', { jobTitle: 'X', feeHuf: 500 });
    expect(
      l.html,
      'a fizetés időpontja üresen/„undefined"-ként maradt — ez a visszaigazolás '
      + 'kötelező eleme',
    ).toMatch(/Fizetés időpontja: \d{4}\. \d{2}\. \d{2}\./);
  });
});

describe('Fizetési emlékeztetők (a platform egyetlen bevétele)', () => {
  it('a három fokozat SZÖVEGE tényleg különbözik', async () => {
    const l0 = await level('sendPaymentDueEmail', { jobTitle: 'Fuvar', feeHuf: 500, agreedPriceHuf: 15000, reminderNo: 0 });
    const l1 = await level('sendPaymentDueEmail', { jobTitle: 'Fuvar', feeHuf: 500, reminderNo: 1 });
    const l2 = await level('sendPaymentDueEmail', { jobTitle: 'Fuvar', feeHuf: 500, reminderNo: 2 });

    expect(l0.subject, 'a megállapodás-kori levél nem a megegyezésről szól').toMatch(/Megegyezés/);
    expect(l0.html, 'a megállapodás-kori levélből hiányzik a megbeszélt fuvardíj').toMatch(/15\D?000 Ft/);
    expect(l1.subject, 'az 1. emlékeztető tárgya nem emlékeztető').toMatch(/Emlékeztető/);
    expect(
      l2.html,
      'AZ UTOLSÓ EMLÉKEZTETŐBŐL HIÁNYZIK A KÖVETKEZMÉNY. Ez az utolsó esély, '
      + 'hogy a tranzakció (és a bevétel) ne akadjon el — a figyelmeztetés nélkül '
      + 'a levél semmivel nem több az előzőnél.',
    ).toMatch(/elévülhet|másik fuvart vállalhat/);
    expect(
      l1.html === l2.html,
      'az 1. és a 2. emlékeztető szó szerint azonos — a fokozás elveszett',
    ).toBe(false);
  });

  it('a levél SOHA nem ígéri, hogy a platform kezeli a fuvardíjat', async () => {
    const l = await level('sendPaymentDueEmail', { jobTitle: 'Fuvar', feeHuf: 500, reminderNo: 0 });
    expect(
      l.html,
      'a levél letétet/„biztonságos őrzést" ígér — a 2026-07-03-i pivot óta a '
      + 'fuvardíj SOSEM folyik át a platformon (ÁSZF 4.)',
    ).not.toMatch(/letét|őrizzük|visszatérítjük a fuvardíjat/i);
  });
});

describe('Lemondási levél — a készpénzes modellben nincs mit visszatéríteni', () => {
  it('a FELADÓNAK nem ígér visszautalást, de közli a díjmentes csere lehetőségét', async () => {
    const l = await level('sendCancellationEmail', {
      recipientName: 'Anna', jobTitle: 'Fuvar', cancelledByRole: 'carrier', recipientIsShipper: true,
    });
    expect(l.html, 'nem derül ki, KI mondta le').toMatch(/a szállító/);
    expect(
      l.html,
      'a levél nem közli egyértelműen, hogy PÉNZMOZGÁS NEM TÖRTÉNT — a feladó '
      + 'visszautalásra várna, és az ügyfélszolgálat vinné el',
    ).toMatch(/Pénzmozgás nem történt/);
    // ⚠️ A „nincs mit visszatéríteni" TAGADÓ szerkezet legitim; a tiltás az
    // ÁLLÍTÓ ígéretekre szól (escrow-kori szöveg visszacsúszása ellen).
    expect(
      l.html,
      'A LEMONDÁSI LEVÉL VISSZAUTALÁST ÍGÉR. A fuvardíj készpénzben járt volna, '
      + 'a platform semmit nem tart — egy ilyen mondat teljesíthetetlen '
      + 'kötelezettséget vállalna (escrow-kori szöveg visszacsúszása).',
    ).not.toMatch(/visszautaljuk|visszatérítjük|visszautalásra kerül|visszatérítésre kerül|a letét/i);
    expect(l.html, 'hiányzik a díjmentes szállító-csere lehetősége').toMatch(/díjmentesen választhatsz/);
  });

  it('a SZÁLLÍTÓNAK szóló változat más szöveget kap', async () => {
    const szallito = await level('sendCancellationEmail', {
      recipientName: 'Béla', jobTitle: 'Fuvar', cancelledByRole: 'shipper', recipientIsShipper: false,
    });
    expect(szallito.html, 'nem derül ki, hogy a feladó mondta le').toMatch(/a feladó/);
    expect(
      szallito.html,
      'a szállító a feladónak szóló, díj-visszatérítésről szóló bekezdést kapta',
    ).not.toMatch(/díjmentesen választhatsz/);
  });
});

describe('DAC7 adóazonosító-kérés (jogszabályi kötelezettség)', () => {
  it('az első kérés megnevezi a jogalapot és a kért adatokat', async () => {
    const l = await level('sendTaxDataRequestEmail', { name: 'Béla', deadline: new Date('2026-09-01'), reminderNo: 0 });
    expect(
      l.html,
      'nem derül ki, MIÉRT kérjük az adóazonosítót — jogalap megnevezése nélkül '
      + 'ez indokolatlan adatbekérésnek látszik (és a GDPR 13. cikket is sérti)',
    ).toMatch(/DAC7|Aktv\./);
    expect(l.html, 'hiányzik a kért adatok felsorolása').toMatch(/Adóazonosító jel/);
    expect(l.html, 'a határidő nem jelent meg').toMatch(/2026\. 09\. 01\./);
  });

  it('az utolsó emlékeztető közli a következményt (ajánlattétel felfüggesztése)', async () => {
    const l2 = await level('sendTaxDataRequestEmail', { name: 'Béla', deadline: '2026-09-01', reminderNo: 2 });
    expect(
      l2.html,
      'AZ UTOLSÓ EMLÉKEZTETŐBŐL HIÁNYZIK A BLOKKOLÁS-FIGYELMEZTETÉS. A '
      + 'szállítót a határidő után tényleg felfüggesztjük — előzetes '
      + 'figyelmeztetés nélkül ez tisztességtelen lenne.',
    ).toMatch(/fel kell függesztenünk/);
    expect(l2.subject).toMatch(/Utolsó emlékeztető/);

    const l0 = await level('sendTaxDataRequestEmail', { name: 'Béla', deadline: '2026-09-01', reminderNo: 0 });
    expect(
      l0.html,
      'már az ELSŐ kérés felfüggesztéssel fenyeget — fölösleges riogatás',
    ).not.toMatch(/fel kell függesztenünk/);

    // A KÖZBÜLSŐ fokozat: emlékeztet, de még nem fenyeget.
    const l1 = await level('sendTaxDataRequestEmail', { name: 'Béla', deadline: '2026-09-01', reminderNo: 1 });
    expect(l1.subject, 'az 1. emlékeztető már „utolsó"-ként megy ki').not.toMatch(/Utolsó/);
    expect(l1.html, 'az 1. emlékeztető már felfüggesztéssel fenyeget').not.toMatch(/fel kell függesztenünk/);
    expect(
      l1.html,
      'az 1. emlékeztetőből nem derül ki, hogy KORÁBBAN már kértük — így '
      + 'megkülönböztethetetlen az első levéltől',
    ).toMatch(/Korábban kértük/);
  });
});

describe('Alvó fiók törlési figyelmeztetés', () => {
  it('közli a dátumot, a következményt és azt, hogy egy belépés elég', async () => {
    const l = await level('sendDormantAccountWarningEmail', { name: 'Anna', deleteDate: new Date('2026-10-01') });
    expect(l.html, 'a törlés dátuma nem jelent meg').toMatch(/2026\. 10\. 01\./);
    expect(
      l.html,
      'nem derül ki, hogy EGY belépés visszaállítja az órát — enélkül a '
      + 'figyelmeztetés nem ad valódi választási lehetőséget',
    ).toMatch(/belépsz/);
    expect(
      l.html,
      'a számviteli 8 éves megőrzésről nem tájékoztat — a felhasználó azt '
      + 'hinné, hogy a törléssel minden adata megszűnik',
    ).toMatch(/8 évig/);
  });
});

describe('Ajánlat- és foglalás-levelek: a készpénzes modell konzisztensen', () => {
  it('az elfogadott ajánlat levele a 100%-os készpénzes fuvardíjat ígéri', async () => {
    const l = await level('sendBidAcceptedEmail', { carrierName: 'Béla', jobTitle: 'Fuvar', amountHuf: 20000 });
    expect(l.html, 'az elfogadott összeg nem szerepel').toMatch(/20\D?000 Ft/);
    expect(
      l.html,
      'nem közli, hogy a fuvardíj készpénzben, levonás nélkül jár — ez a '
      + 'szállítói értékajánlat lényege',
    ).toMatch(/készpénzben/);
  });

  it('a foglalás-elutasítás közli, hogy nem volt pénzmozgás', async () => {
    const l = await level('sendBookingRejectedEmail', { shipperName: 'Anna', routeTitle: 'BP–Szeged' });
    expect(
      l.html,
      'az elutasított foglalásnál nem nyugtatjuk meg a feladót, hogy nincs '
      + 'pénzmozgás — ez a leggyakoribb ügyfélszolgálati kérdés',
    ).toMatch(/Nem volt pénzmozgás/);
  });

  it('az útvonal-figyelő levele nem ígér nem létező appot', async () => {
    const l = await level('sendLaneAlertEmail', {
      carrierName: 'Béla', jobTitle: 'Fuvar', routeLabel: 'BP → Szeged', priceHuf: 12000,
    });
    expect(
      l.html,
      'a levél alkalmazás-letöltést emleget — NINCS natív app (a chatbot '
      + 'rendszerprompt kifejezetten tiltja ennek állítását)',
    ).not.toMatch(/App Store|Google Play|töltsd le az appot/i);
    expect(l.html, 'a figyelő kikapcsolásáról nem tájékoztat (GDPR-átláthatóság)').toMatch(/kikapcsolhatod/);

    const arNelkul = await level('sendLaneAlertEmail', { carrierName: 'B', jobTitle: 'F', routeLabel: 'X' });
    expect(arNelkul.html, 'ár nélkül is „~0 Ft" ár-blokk került a levélbe').not.toMatch(/~0 Ft/);
  });
});

// =====================================================================
//  5) A TESZT SAJÁT BIZTONSÁGA
// =====================================================================
describe('A teszt nem küld valódi levelet', () => {
  it('stub módban egyetlen Resend-kérés sem indult', async () => {
    process.env.RESEND_API_KEY = '';
    const hivas = vi.spyOn(global, 'fetch');
    await email.sendRecipientTrackingEmail({
      to: 'valaki@example.com', recipientName: 'X', jobTitle: 'Y',
      trackingUrl: 'https://gofuvar.hu/x', deliveryCode: '123456',
    });
    expect(
      hivas,
      'VALÓDI RESEND-KÉRÉS INDULT A TESZTBŐL. Ez élesben valódi levelet küldene '
      + 'egy valódi címre, a mi kvótánkból.',
    ).not.toHaveBeenCalled();
  });
});
