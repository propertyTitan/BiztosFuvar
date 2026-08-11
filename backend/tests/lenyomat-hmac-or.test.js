// =====================================================================
//  LENYOMAT-ŐR: minden tárolt hash HMAC, sózatlan nem térhet vissza
//
//  ⚠️ MIÉRT (2026-08-11, 073-as migráció): a magyar személyi igazolvány
//  számának értéktere teljesen felsorolható (~10^8), ezért egy SÓZATLAN
//  SHA-256 ezen a téren nem egyirányú függvény, hanem lassított keresés.
//  Közben HÁROM publikált dokumentum állítja, hogy „ebből az okmányszám nem
//  állítható vissza" (tájékoztató, 30. cikkes nyilvántartás,
//  érdekmérlegelési teszt II.).
//
//  A 7 legacy sort a 073-as migráció elvitte. Ez az őr azt védi, hogy
//  NE JÖHESSEN VISSZA — se új kódúton, se egy visszacsúszó refaktorral.
//
//  A 061-es migráció ugyanezt az érvelést már leírta az e-mail-lenyomatnál,
//  a 063 mégis sózatlanul vezette be az okmány-lenyomatot. Vagyis a helyes
//  érvelés önmagában nem elég — kikényszerítés kell hozzá.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'fs';

const require = createRequire(import.meta.url);
const { db } = require('./helpers');
const { hmac } = require('../src/utils/pepper');

/** Minden .js a src alatt, rekurzívan. */
function jsFajlok(mappa, elotag = '') {
  const ki = [];
  for (const b of readdirSync(mappa, { withFileTypes: true })) {
    const ut = `${mappa}/${b.name}`;
    const rel = elotag ? `${elotag}/${b.name}` : b.name;
    if (b.isDirectory()) { ki.push(...jsFajlok(ut, rel)); continue; }
    if (b.name.endsWith('.js')) ki.push({ nev: rel, ut });
  }
  return ki;
}

describe('Okmány-lenyomat: kizárólag HMAC', () => {
  it('a DB-ben nincs sózatlan (legacy) lenyomat', async () => {
    for (const tabla of ['kyc_documents', 'kyc_doc_history']) {
      const { rows } = await db.query(
        `SELECT count(*)::int AS db FROM ${tabla} WHERE hash_algo = 'sha256-legacy'`,
      );
      expect(
        rows[0].db,
        `A(z) ${tabla} táblában maradt sózatlan lenyomat.\n\n`
        + 'A személyi igazolvány számának értéktere felsorolható, ezért a\n'
        + 'sózatlan hash visszafejthető — miközben a tájékoztató, a 30. cikkes\n'
        + 'nyilvántartás és az érdekmérlegelési teszt is azt állítja, hogy nem.\n'
        + 'A 073-as migráció ezeket elvitte; ha visszakerültek, valami\n'
        + 'sózatlanul ír a táblába.',
      ).toBe(0);
    }
  });

  it('a lenyomat-számítás a szerver-oldali titkot használja (nem puszta SHA-256)', () => {
    const crypto = require('crypto');
    const minta = '123456AB';
    const sozatlan = crypto.createHash('sha256').update(minta).digest('hex');
    expect(
      hmac(minta),
      'A lenyomat MEGEGYEZIK a sózatlan SHA-256-tal — vagyis a pepper nem hat.\n'
      + 'Ez pontosan az a hiba, amit a 064-es migráció javított.',
    ).not.toBe(sozatlan);
    // …és determinisztikus, különben a duplikátum-védelem nem működne
    expect(hmac(minta)).toBe(hmac(minta));
  });

  it('SEHOL a kódban nem készül sózatlan hash okmányszámból', () => {
    const gyanus = [];
    for (const { nev, ut } of jsFajlok(`${__dirname}/../src`)) {
      const forras = readFileSync(ut, 'utf8')
        .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      // createHash(...) egy olyan blokkban, ami okmányszámmal dolgozik
      for (const m of forras.matchAll(/createHash\(\s*['"]sha\d+['"]\s*\)[\s\S]{0,160}/g)) {
        const blokk = m[0];
        if (/docNumber|doc_number|okmany|okmány/i.test(blokk)) {
          gyanus.push(`${nev}: ${blokk.slice(0, 70).replace(/\s+/g, ' ')}…`);
        }
      }
    }
    expect(
      gyanus,
      `Sózatlan hash készül okmányszámból:\n  ${gyanus.join('\n  ')}\n\n`
      + 'Használd a utils/pepper.js hmac() függvényét. A sózatlan lenyomat\n'
      + 'ezen az értéktéren visszafejthető, és három dokumentumnak mondana ellent.',
    ).toEqual([]);
  });

  it('az új lenyomatok HMAC-ként jelölődnek a beíráskor', () => {
    const forras = readFileSync(`${__dirname}/../src/utils/kycHistory.js`, 'utf8')
      .replace(/\/\/[^\n]*/g, '');
    expect(
      forras.includes("'hmac-sha256'"),
      'A kyc_doc_history beírás nem jelöli HMAC-ként a lenyomatot — a jelölés\n'
      + 'nélkül nem tudnánk kimutatni egy jövőbeli visszacsúszást.',
    ).toBe(true);
    expect(forras.includes("'sha256-legacy'")).toBe(false);
  });
});
