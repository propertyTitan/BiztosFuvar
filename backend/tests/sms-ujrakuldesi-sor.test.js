// =====================================================================
//  SMS-ÚJRAKÜLDÉSI SOR — a néma SMS-kiesés második védvonala (2026-08-30)
//
//  ELŐZMÉNY: 2026-08-20 és 08-30 között ÉLESBEN 10 napig egyetlen címzetti
//  SMS sem ment ki (SeeMe code=13 — a Railway kimenő IP-je elfordult), és
//  a Sentry-riasztáson kívül semmi nem történt: az SMS-ek VÉGLEG elvesztek,
//  a hiba elhárítása után sem mentek ki. A címzett az átvételi kódot az
//  EGYETLEN csatornáján nem kapta meg.
//
//  A védvonal három része, amit ez a fájl mér:
//    1. az újrapróbálható hiba (code=13/7, hálózati) SORBA kerül, a többi nem;
//    2. az üzemeltető KÖZVETLEN e-mailt kap (throttle-olva — nem spam);
//    3. az újraküldő kör kézbesít, ha a gateway helyreállt; ha nem, a sort
//       NEM duplikálja; 48 óra után felad, és a napi retenció törli a PII-t.
//
//  Mindegyik teszt akkor bukna el, ha a hozzá tartozó védelem eltűnne —
//  pl. a queueOnFailure flag kivétele a 6. tesztet duplikált sorral buktatja.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { db } = require('./helpers');
const sms = require('../src/services/sms');
const smsRetry = require('../src/services/smsRetry');
const retention = require('../src/services/retention');
const emailService = require('../src/services/email');

const EREDETI_KULCS = process.env.SEEME_API_KEY;
const EREDETI_DSN = process.env.SENTRY_DSN;

/** A SeeMe query-string alakú válaszát utánozzuk (sms-hibamodok mintája). */
function seemeValasz(text) {
  return vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, text: async () => text,
  });
}

let emailSpy;

beforeEach(async () => {
  process.env.SEEME_API_KEY = 'teszt-kulcs';
  process.env.SENTRY_DSN = 'https://teszt@example.ingest.sentry.io/1';
  await db.query('DELETE FROM sms_retry_queue');
  sms.resetSmsAlertThrottle();
  emailSpy = vi.spyOn(emailService, 'sendEmail').mockResolvedValue({ stub: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (EREDETI_KULCS === undefined) delete process.env.SEEME_API_KEY;
  else process.env.SEEME_API_KEY = EREDETI_KULCS;
  if (EREDETI_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = EREDETI_DSN;
});

describe('Sorba tétel: mi kerül a sorba és mi nem', () => {
  it('code=13 (IP) → a sor megőrzi az üzenetet, és riasztó e-mail megy', async () => {
    seemeValasz('code=13&message=IP not allowed');

    const res = await sms.sendSms('+36301234567', 'GoFuvar: átvételi kód: 123456');
    expect(res.ok).toBe(false);

    const { rows } = await db.query('SELECT * FROM sms_retry_queue');
    expect(
      rows.length,
      'A code=13-as elutasítás NEM került az újraküldési sorba — az SMS '
      + 'véglegesen elveszne, pontosan ahogy 2026-08-20 és 08-30 között élesben.',
    ).toBe(1);
    expect(rows[0].phone, 'a sorba a NORMALIZÁLT számnak kell kerülnie').toBe('36301234567');
    expect(rows[0].message).toBe('GoFuvar: átvételi kód: 123456');
    expect(rows[0].last_error).toContain('code=13');

    expect(
      emailSpy,
      'Nem ment üzemeltetői e-mail a code=13-ról — a Sentryt senki nem nézi naponta.',
    ).toHaveBeenCalledTimes(1);
    const level = emailSpy.mock.calls[0][0];
    expect(level.to).toBe('info@gofuvar.hu');
    expect(level.subject).toContain('code=13');
  });

  it('code=7 (egyenleg) → sorba kerül; a riasztás hibamódonként throttle-olt', async () => {
    seemeValasz('code=7&message=Not enough balance');

    await sms.sendSms('+36301111111', 'Első üzenet');
    await sms.sendSms('+36302222222', 'Második üzenet');

    const { rows } = await db.query('SELECT * FROM sms_retry_queue ORDER BY created_at');
    expect(rows.length, 'MINDKÉT elakadt SMS-nek a sorban a helye').toBe(2);

    expect(
      emailSpy,
      'A riasztó e-mailnek hibamódonként EGYSZER kell mennie 6 órán belül — '
      + 'különben egy elakadt SMS-kötegnél levelenként spammelnénk magunkat.',
    ).toHaveBeenCalledTimes(1);

    // Másik hibamód (code=13) → az külön riasztást érdemel.
    vi.restoreAllMocks();
    emailSpy = vi.spyOn(emailService, 'sendEmail').mockResolvedValue({ stub: true });
    seemeValasz('code=13&message=IP not allowed');
    await sms.sendSms('+36303333333', 'Harmadik üzenet');
    expect(emailSpy, 'a MÁSIK hibamód (code=13) külön riasztást kap').toHaveBeenCalledTimes(1);
    expect(emailSpy.mock.calls[0][0].subject).toContain('code=13');
  });

  it('NEM újrapróbálható kód (code=9, tiltott feladó) → NEM kerül sorba', async () => {
    seemeValasz('code=9&message=Sender not allowed');

    const res = await sms.sendSms('+36301234567', 'Teszt');
    expect(res.ok).toBe(false);

    const { rows } = await db.query('SELECT * FROM sms_retry_queue');
    expect(
      rows.length,
      'A nem-átmeneti hiba (rossz konfig/szám) NEM való a sorba: az újraküldés '
      + 'ugyanúgy elhasalna, a sor csak PII-t gyűjtene értelmetlenül.',
    ).toBe(0);
    expect(emailSpy, 'a 6 óránkénti riasztás csak az ismert, elhárítható hibamódoké').not.toHaveBeenCalled();
  });

  it('hálózati hiba (fetch dob) → sorba kerül, e-mail riasztás nélkül', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));

    const res = await sms.sendSms('+36301234567', 'Teszt üzenet');
    expect(res.ok).toBe(false);

    const { rows } = await db.query('SELECT * FROM sms_retry_queue');
    expect(rows.length, 'az átmeneti hálózati hiba is újrapróbálást érdemel').toBe(1);
    expect(rows[0].last_error).toContain('halozat');
    expect(emailSpy, 'egyszeri hálózati hibára nem riasztunk e-mailben (a Sentry jelez)').not.toHaveBeenCalled();
  });
});

describe('Az újraküldő kör (runSmsRetryQueue)', () => {
  it('helyreállt gateway → kézbesít és TÖRLI a sort', async () => {
    await db.query(
      'INSERT INTO sms_retry_queue (phone, message, last_error) VALUES ($1, $2, $3)',
      ['36301234567', 'GoFuvar: átvételi kód: 654321', 'code=13'],
    );
    const fetchSpy = seemeValasz('result=OK&code=0&price=19');

    const sent = await smsRetry.runSmsRetryQueue();

    expect(sent, 'a kör nem kézbesítette a bennragadt SMS-t').toBe(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const hivottUrl = String(fetchSpy.mock.calls[0][0]);
    expect(hivottUrl).toContain('number=36301234567');
    expect(hivottUrl).toContain(encodeURIComponent('654321'));

    const { rows } = await db.query('SELECT * FROM sms_retry_queue');
    expect(
      rows.length,
      'A kézbesített sornak AZONNAL törlődnie kell — PII (telefonszám + '
      + 'átvételi kód) nem maradhat a táblában, ha már célba ért.',
    ).toBe(0);
  });

  it('továbbra is hibázó gateway → a sor MARAD, de NEM duplikálódik', async () => {
    await db.query(
      'INSERT INTO sms_retry_queue (phone, message, last_error) VALUES ($1, $2, $3)',
      ['36301234567', 'Teszt üzenet', 'code=13'],
    );
    seemeValasz('code=13&message=IP not allowed');

    const sent = await smsRetry.runSmsRetryQueue();
    expect(sent).toBe(0);

    const { rows } = await db.query('SELECT * FROM sms_retry_queue');
    expect(
      rows.length,
      'A sikertelen újrapróba DUPLIKÁLTA a sort — a queueOnFailure:false '
      + 'védelem eltűnt a körből: minden kör megduplázná a sort, és a gateway '
      + 'helyreállásakor a címzett ugyanazt az SMS-t 2^n-szer kapná meg.',
    ).toBe(1);
    expect(rows[0].attempts, 'a kísérlet-számlálónak nőnie kell (claim)').toBe(1);
    expect(emailSpy, 'az újraküldő kör kudarca nem generál újabb riasztó e-mailt').not.toHaveBeenCalled();
  });

  it('48 óránál régebbi sort már nem próbál; a napi retenció törli (Sentry-jelzéssel)', async () => {
    await db.query(
      `INSERT INTO sms_retry_queue (phone, message, last_error, created_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '49 hours')`,
      ['36301234567', 'Rég elakadt üzenet', 'code=13'],
    );
    const fetchSpy = vi.spyOn(global, 'fetch');
    const sentry = require('@sentry/node');
    const sentryUzenetek = [];
    vi.spyOn(sentry, 'captureMessage').mockImplementation((m) => { sentryUzenetek.push(String(m)); });

    const sent = await smsRetry.runSmsRetryQueue();
    expect(sent).toBe(0);
    expect(
      fetchSpy,
      '48 óra után a felvételi SMS okafogyott — a kör nem küldheti újra',
    ).not.toHaveBeenCalled();

    const torolt = await retention.purgeExpiredSmsRetryQueue();
    expect(torolt, 'a napi retenciónak törölnie kell a lejárt PII-sort').toBe(1);
    const { rows } = await db.query('SELECT * FROM sms_retry_queue');
    expect(rows.length).toBe(0);
    expect(
      sentryUzenetek.some((m) => /kézbesítetlen/.test(m)),
      'A VÉGLEGES kézbesítetlenség Sentry-jelzést érdemel: a címzett sosem '
      + 'kapta meg az átvételi kódot, erről tudnia kell az üzemeltetőnek.',
    ).toBe(true);
  });

  it('a 10 perces próbaköz betartva: friss próbálkozású sort békén hagy', async () => {
    await db.query(
      `INSERT INTO sms_retry_queue (phone, message, last_error, attempts, last_attempt_at)
       VALUES ($1, $2, $3, 1, NOW() - INTERVAL '2 minutes')`,
      ['36301234567', 'Teszt üzenet', 'code=13'],
    );
    const fetchSpy = vi.spyOn(global, 'fetch');

    const sent = await smsRetry.runSmsRetryQueue();
    expect(sent).toBe(0);
    expect(
      fetchSpy,
      'A két próba közti minimum köz (10 perc) eltűnt — az elakadt gateway-t '
      + 'nem szabad percenként verni.',
    ).not.toHaveBeenCalled();

    const { rows } = await db.query('SELECT attempts FROM sms_retry_queue');
    expect(rows[0].attempts, 'a ki nem választott sor számlálója nem nőhet').toBe(1);
  });

  it('stub módban (nincs SEEME_API_KEY) a kör "kézbesítettnek" veszi és üríti a sort', async () => {
    // Élesben ez az ág nem él (a kulcs be van állítva); a lényeg, hogy a
    // kulcs eltűnésekor a sor ne duzzadjon a végtelenségig.
    delete process.env.SEEME_API_KEY;
    await db.query(
      'INSERT INTO sms_retry_queue (phone, message) VALUES ($1, $2)',
      ['36301234567', 'Teszt üzenet'],
    );

    const sent = await smsRetry.runSmsRetryQueue();
    expect(sent).toBe(1);
    const { rows } = await db.query('SELECT * FROM sms_retry_queue');
    expect(rows.length).toBe(0);
  });
});
