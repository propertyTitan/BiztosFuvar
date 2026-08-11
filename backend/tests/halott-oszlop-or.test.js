// =====================================================================
//  HALOTT OSZLOP ŐR (2026-08-11, 9. mérés D1)
//
//  ⚠️ ÖT MIGRÁCIÓS KÖR (066/070/071/072/074) TAKARÍTOTT HALOTT SÉMÁT, és
//  MINDEGYIK talált olyat, amit az előző kihagyott — mert mind KÉZI listával
//  dolgozott. Ez volt az egyetlen hibaosztály a rendszerben, amit nem őr
//  védett, hanem éberség. A retenciós manifest minden TÁBLÁT bejár, de az
//  OSZLOPOKAT nem.
//
//  Miért nem kozmetika: a halott oszlop
//    * „meglévőnek" látszik a sémában, tehát egy jövőbeli lekérdezés némán
//      elavult értéket olvashat (a `users.kyc_status` pontosan ezt csinálta:
//      a 027 óta más mező az élő, de a régi 'verified' bennmaradt);
//    * fájl-URL oszlopnál azonnali árva-gyár (a `reviews.photo_url` és az
//      `invoices.pdf_url` ezért ment);
//    * és amit senki nem olvas, arra retenciót sem ír senki — vagyis a
//      benne álló személyes adat határidő nélkül marad.
//
//  Az őr a VALÓS sémából olvas (information_schema), és minden oszlopra
//  megköveteli, hogy legyen legalább egy kód-hivatkozás VAGY írásos indok.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'fs';

const require = createRequire(import.meta.url);
const { db } = require('./helpers');

// Oszlopok, amikre nincs kód-hivatkozás, DE indokoltan maradnak.
const KIVETELEK = {
  'kyc_doc_history.first_seen_at':
    'A purge a last_seen_at-ra fut, tehát ez nem hajt semmit — de ez az egyetlen '
    + 'nyom arról, MIÓTA tartunk egy okmány-lenyomatot, ami az érdekmérlegelési '
    + 'teszt II. pontjának arányossági érveléséhez kell.',
  'retention_runs.id':
    'Elsődleges kulcs; a naplósor azonosítója. Kódból nem hivatkozott, de a '
    + 'tábla rendezéséhez és a sorok megkülönböztetéséhez kell.',
};

// Ezeket a séma-elemeket nem vizsgáljuk (nem a mi adatunk).
const KIHAGYOTT_TABLAK = new Set(['schema_migrations', 'pgmigrations']);

/** Minden forrásfájl egyetlen szövegben (backend + web). */
function osszesForras() {
  const darabok = [];
  const bejar = (mappa) => {
    for (const b of readdirSync(mappa, { withFileTypes: true })) {
      const ut = `${mappa}/${b.name}`;
      if (b.isDirectory()) {
        if (b.name === 'node_modules' || b.name === '.next') continue;
        bejar(ut);
        continue;
      }
      if (/\.(js|ts|tsx)$/.test(b.name)) darabok.push(readFileSync(ut, 'utf8'));
    }
  };
  bejar(`${__dirname}/../src`);
  for (const w of ['../../web/src', '../../web/app']) {
    try { bejar(`${__dirname}/${w}`); } catch { /* nincs ilyen mappa */ }
  }
  return darabok.join('\n');
}

describe('Halott oszlop őr: minden séma-oszlopnak van gazdája', () => {
  it('nincs olyan oszlop, amit senki nem olvas és nincs rá indok', async () => {
    const { rows } = await db.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY 1, 2`,
    );
    expect(rows.length, 'nem sikerült kiolvasni a sémát — az őr vak').toBeGreaterThan(100);

    const forras = osszesForras();
    // Szó-határos keresés: a `notes` ne illeszkedjen az `ai_description_notes`-ra.
    const hivatkozott = (nev) => new RegExp(`\\b${nev}\\b`).test(forras);

    const arvak = [];
    for (const { table_name: tabla, column_name: oszlop } of rows) {
      if (KIHAGYOTT_TABLAK.has(tabla)) continue;
      const kulcs = `${tabla}.${oszlop}`;
      if (KIVETELEK[kulcs]) continue;
      // Az `id`, `created_at`, `updated_at` szinte mindenhol előfordul —
      // ezeket a szó-határos keresés amúgy is megtalálja, nem kell külön kezelni.
      if (!hivatkozott(oszlop)) arvak.push(kulcs);
    }

    expect(
      arvak,
      `Ezeket az oszlopokat SENKI nem olvassa a kódban:\n  ${arvak.join('\n  ')}\n\n`
      + 'Öt migrációs kör takarított halott sémát, és mindegyik talált olyat,\n'
      + 'amit az előző kihagyott — mert kézi listával dolgoztak. Ez az őr ezt\n'
      + 'az osztályt zárja.\n\n'
      + 'Döntsd el mindegyikről:\n'
      + '  * tényleg halott → DROP COLUMN migrációval (előbb a prodon nézd meg,\n'
      + '    van-e benne adat!)\n'
      + '  * indokoltan marad → vedd fel a KIVETELEK listára, leírva MIÉRT\n\n'
      + 'A halott oszlop nem kozmetika: „meglévőnek" látszik, tehát egy jövőbeli\n'
      + 'lekérdezés némán elavult értéket olvashat (a users.kyc_status pontosan\n'
      + 'ezt csinálta), fájl-URL-nél árva-gyár, és amit senki nem olvas, arra\n'
      + 'retenciót sem ír senki.',
    ).toEqual([]);
  });

  it('a kivétel-lista nem avulhat el', async () => {
    const { rows } = await db.query(
      `SELECT table_name || '.' || column_name AS kulcs
         FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const letezo = new Set(rows.map((r) => r.kulcs));
    const holt = Object.keys(KIVETELEK).filter((k) => !letezo.has(k));
    expect(holt, `Nem létező oszlop a kivétel-listán: ${holt.join(', ')}`).toEqual([]);
  });

  it('a kivételek indoklása érdemi', () => {
    for (const [k, v] of Object.entries(KIVETELEK)) {
      expect(v.length > 60, `A(z) "${k}" indoklása túl rövid.`).toBe(true);
    }
  });
});
