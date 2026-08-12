// =====================================================================
//  SMS: A VALÓS ÉLES HIBAMÓDOK (2026-08-12)
//
//  ⚠️ 25%-OS ELÁGAZÁS-LEFEDETTSÉGEN ÁLLT — pedig a CLAUDE.md két konkrét,
//  TAPASZTALT éles hibamódot nevez meg:
//
//    code=13 → a Railway kimenő IP-je nincs engedélyezve a SeeMe-nél.
//              Az IP-allowlist a SeeMe-nél NEM kikapcsolható, és a Railway
//              IP-je elfordulhat. Ilyenkor MINDEN SMS NÉMÁN kiesik — a
//              címzett sosem kapja meg az átvételi kódot, és semmi nem szól,
//              hacsak a Sentry-riasztás nem megy ki.
//    code=7  → elfogyott a SeeMe-egyenleg. Ugyanaz a néma kiesés.
//
//  Ez az egyetlen csatorna, amin a CÍMZETT (aki nem felhasználónk) megkapja
//  az átvételi kódot. Ha némán elszáll, a fuvart nem lehet lezárni — és a
//  hibáról csak a felhasználói panaszból értesülnénk.
//
//  Ez a fájl a hibaágakat méri, nem a boldog utat.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const sms = require('../src/services/sms');

const EREDETI_KULCS = process.env.SEEME_API_KEY;

const EREDETI_DSN = process.env.SENTRY_DSN;
beforeEach(() => {
  process.env.SEEME_API_KEY = 'teszt-kulcs';
  // ⚠️ A riasztás SENTRY_DSN-hez kötött (helyesen: DSN nélkül nincs hova
  // küldeni). A teszt-környezet kiüríti a kulcsokat, ezért itt beállítjuk —
  // különben a riasztási ágat SOSEM mérnénk, és pont az a lényeg.
  process.env.SENTRY_DSN = 'https://teszt@example.ingest.sentry.io/1';
});
afterEach(() => {
  vi.restoreAllMocks();
  if (EREDETI_KULCS === undefined) delete process.env.SEEME_API_KEY;
  else process.env.SEEME_API_KEY = EREDETI_KULCS;
  if (EREDETI_DSN === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = EREDETI_DSN;
});

/** A SeeMe query-string alakú válaszát utánozzuk. */
function seemeValasz(text) {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true, status: 200, text: async () => text,
  });
}

describe('SMS hibamódok (a néma kiesés ellen)', () => {
  it('code=13 (IP nincs engedélyezve) → SENTRY-RIASZTÁS megy', async () => {
    const sentry = require('@sentry/node');
    const uzenetek = [];
    vi.spyOn(sentry, 'captureMessage').mockImplementation((m) => { uzenetek.push(String(m)); });
    seemeValasz('code=13&message=IP not allowed');

    const res = await sms.sendSms('+36301234567', 'Teszt üzenet');

    expect(res.ok, 'a code=13-at sikeresnek jelentettük').toBe(false);
    expect(
      uzenetek.some((m) => /IP|13/.test(m)),
      'A code=13-ról NEM ment Sentry-riasztás.\n\n'
      + 'Ez a legveszélyesebb SMS-hibamód: a Railway kimenő IP-je elfordult, a\n'
      + 'SeeMe minden küldést eldob, és a CÍMZETT SOSEM kapja meg az átvételi\n'
      + 'kódot. Riasztás nélkül erről csak panaszból értesülnénk.',
    ).toBe(true);
  });

  it('code=7 (elfogyott az egyenleg) → szintén riaszt', async () => {
    const sentry = require('@sentry/node');
    const uzenetek = [];
    vi.spyOn(sentry, 'captureMessage').mockImplementation((m) => { uzenetek.push(String(m)); });
    seemeValasz('code=7&message=insufficient balance');

    const res = await sms.sendSms('+36301234567', 'Teszt');
    expect(res.ok).toBe(false);
    expect(uzenetek.length, 'az egyenleg-hiányról nem ment riasztás').toBeGreaterThan(0);
  });

  it('sikeres küldés (result=OK) nem riaszt', async () => {
    const sentry = require('@sentry/node');
    const uzenetek = [];
    vi.spyOn(sentry, 'captureMessage').mockImplementation((m) => { uzenetek.push(String(m)); });
    seemeValasz('result=OK&price=19');

    const res = await sms.sendSms('+36301234567', 'Teszt');
    expect(res.ok, 'a sikeres küldést hibának vettük').toBe(true);
    expect(uzenetek, 'sikeres küldésnél is riasztottunk — a riasztás elveszti az értékét').toEqual([]);
  });

  it('hálózati hiba esetén sem dob (a fuvar-folyamat nem akadhat el)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const res = await sms.sendSms('+36301234567', 'Teszt');
    expect(res.ok, 'hálózati hibánál sikert jelentettünk').toBe(false);
  });

  it('hiányzó telefonszám / üzenet esetén nem hív külső szolgáltatót', async () => {
    const hivas = vi.spyOn(global, 'fetch');
    for (const [tel, uz] of [[null, 'x'], ['+36301234567', ''], ['', ''], [undefined, undefined]]) {
      const res = await sms.sendSms(tel, uz);
      expect(res.ok).toBe(false);
    }
    expect(hivas, 'hiányos adatra is elindítottunk SMS-kérést (pénzbe kerül)').not.toHaveBeenCalled();
  });

  it('STUB módban (kulcs nélkül) nem hív ki, de sikert jelent', async () => {
    delete process.env.SEEME_API_KEY;
    const hivas = vi.spyOn(global, 'fetch');
    const res = await sms.sendSms('+36301234567', 'Teszt');
    expect(res.stub, 'stub módban nem stubként viselkedett').toBe(true);
    expect(hivas, 'STUB módban is kihívtunk a SeeMe-hez').not.toHaveBeenCalled();
  });

  it('a szegmens-számítás ékezetesre (UCS-2) helyesen 70 karakterenként vált', () => {
    // Az ékezetes SMS UCS-2, ott 70 kar/szegmens (a GSM-7 160 helyett).
    // Ez pénz: szegmensenként ~19 Ft, fuvaronként.
    expect(sms.smsSegments('a'.repeat(60))).toBe(1);
    expect(sms.smsSegments(`${'á'.repeat(60)}`)).toBe(1);
    expect(sms.smsSegments(`${'á'.repeat(80)}`)).toBeGreaterThan(1);
  });

  it('a telefonszám normalizálása kezeli a magyar alakokat', () => {
    for (const be of ['+36301234567', '06301234567', '06 30 123 4567', '+36 30 123-4567']) {
      const ki = sms.normalizePhone(be);
      expect(ki, `${be} → ${ki}`).toMatch(/^\+?\d+$/);
    }
  });
});
