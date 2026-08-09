// =====================================================================
//  TESZT-KÖRNYEZET ŐRE — a suite ne érjen el ÉLES szolgáltatást
//
//  Miért (2026-08-09, audit 3. kör): az `env-setup.js` eddig `delete`-tel
//  törölte a külső kulcsokat, csakhogy az `src/index.js` első sora
//  `require('dotenv').config()` — ami a backend/.env-ből VISSZATÖLTI, ami épp
//  nem létezik. A törlés tehát hatástalan volt: a teszt-futás alatt az R2- és
//  a Gemini-kulcs ÉLT. Következmény: a fájl-feltöltő tesztek valódi
//  objektumokat írtak az ÉLES bucketekbe (a privát KYC-bucketbe is), a
//  KYC-tesztek pedig valódi, fizetős AI-hívásokat indíthattak.
//
//  Ez a fájl azt őrzi, hogy ez ne csúszhasson vissza: minden külső integráció
//  stub, a tároló lokális, az adatbázis a beágyazott teszt-példány.
// =====================================================================
import { describe, it, expect } from 'vitest';

const storage = require('../src/services/storage');
const email = require('../src/services/email');
const sms = require('../src/services/sms');
const paymentProvider = require('../src/services/paymentProvider');

// Minden kulcs, aminek a jelenléte VALÓDI (fizetős vagy adatot kiküldő)
// külső hívást okozna. Ha új integráció jön, ide is fel kell venni.
const TILTOTT_KULCSOK = [
  'SEEME_API_KEY', 'RESEND_API_KEY', 'SENTRY_DSN',
  'GEMINI_API_KEY', 'GOOGLE_MAPS_API_KEY',
  'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'R2_PRIVATE_BUCKET_NAME',
  'CIB_API_KEY', 'CIB_MERCHANT_ID',
  'QVIK_API_KEY', 'QVIK_MERCHANT_ID',
  'SZAMLAZZ_AGENT_KEY',
  'NAV_ONLINE_LOGIN', 'NAV_ONLINE_PASSWORD', 'NAV_ONLINE_SIGNKEY',
];

describe('Teszt-környezet: semmi nem megy ki élesbe', () => {
  it('egyetlen éles külső kulcs sem él a teszt alatt', () => {
    const elok = TILTOTT_KULCSOK.filter((k) => !!process.env[k]);
    expect(
      elok,
      'ÉLES KULCS a teszt-környezetben! A tesztek valódi külső szolgáltatást hívnának '
      + '(fizetős API / éles tároló). Vedd fel az env-setup.js semlegesítendő listájába. '
      + '⚠️ `delete` NEM elég — a dotenv visszatölti; üres stringre kell állítani.',
    ).toEqual([]);
  });

  it('a tároló lokális disk módban van (nem az éles R2)', () => {
    expect(storage.isPersistent(), 'a teszt-feltöltések az ÉLES R2-be mennének').toBe(false);
  });

  it('email és SMS stub, fizetési provider stub', () => {
    expect(email.isStub(), 'a tesztek valódi e-mailt küldenének').toBe(true);
    expect(sms.isStub(), 'a tesztek valódi (fizetős) SMS-t küldenének').toBe(true);
    expect(paymentProvider.isStub(), 'a tesztek valódi fizetést indítanának').toBe(true);
  });

  it('az adatbázis a beágyazott teszt-példány, nem a prod Neon', () => {
    expect(process.env.DATABASE_URL).toContain('127.0.0.1:54331');
    expect(process.env.DATABASE_URL).not.toContain('neon.tech');
  });
});
