// =====================================================================
//  ŐR: NINCS BACKTICK AZ SQL-KOMMENTBEN (2026-08-11)
//
//  ⚠️ EZT A HIBÁT NÉGYSZER KÖVETTEM EL EBBEN A MUNKÁBAN. A JS template
//  literálban írt SQL-be `-- …` kommentet teszek, és a kommentben backtickkel
//  emelek ki egy oszlopnevet — a backtick viszont LEZÁRJA a template
//  literált. Az eredmény: a modul be sem töltődik, tehát a TELJES BACKEND
//  nem indul el.
//
//  Mindannyiszor a tesztfuttatás fogta meg, de mindig percekbe került
//  kideríteni, mert a hibaüzenet (`missing ) after argument list`) a
//  require-helyre mutat, nem a valódi okra.
//
//  Ez az őr olcsó, és pontosan megmondja, hol a baj.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';

function jsFajlok(dir) {
  const out = [];
  for (const be of readdirSync(dir, { withFileTypes: true })) {
    if (be.isDirectory()) out.push(...jsFajlok(`${dir}/${be.name}`));
    else if (be.name.endsWith('.js')) out.push(`${dir}/${be.name}`);
  }
  return out;
}

describe('Nincs backtick az SQL-kommentekben', () => {
  it('egyetlen `-- …` SQL-komment sem tartalmaz backticket', () => {
    const gondok = [];
    for (const fajl of jsFajlok(`${__dirname}/../src`)) {
      const sorok = readFileSync(fajl, 'utf8').split('\n');
      sorok.forEach((sor, i) => {
        const t = sor.trim();
        // SQL-komment (nem JS `//`), ami backticket tartalmaz
        if (/^--\s/.test(t) && t.includes('`')) {
          gondok.push(`${fajl.replace(/.*\/src\//, 'src/')}:${i + 1}  ${t.slice(0, 70)}`);
        }
      });
    }
    expect(
      gondok,
      'Backtick egy SQL-kommentben — ez LEZÁRJA a JS template literált, és a\n'
      + 'modul be sem töltődik (a teljes backend nem indul):\n  '
      + gondok.join('\n  ')
      + '\n\nHasználj sima szöveget: `oszlop_nev` helyett oszlop_nev.',
    ).toEqual([]);
  });
});

// =====================================================================
//  JS-KOMMENT AZ SQL-BEN (2026-08-11)
//
//  ⚠️ A BACKTICK TESTVÉRE. Ma egy `// …` sort írtam egy SQL template
//  literal belsejébe: a Postgres `syntax error at or near "//"`-t adott, az
//  `anonymizeOldJobs` catch-e pedig CSENDBEN lenyelte, és 0-t adott vissza.
//  A napi kör „sikeresnek" látszott — az anonimizálás hónapokig futhatott
//  volna hatás nélkül. (A catch azóta továbbdobja a hibát.)
//
//  Az SQL-ben a komment `--`, nem `//`.
// =====================================================================
describe('Nincs JS-komment az SQL-ben', () => {
  it('egyetlen SQL template literal sem tartalmaz `//` kommentsort', () => {
    const { readFileSync, readdirSync } = require('fs');
    const talalatok = [];

    const bejar = (mappa, elotag = '') => {
      for (const b of readdirSync(mappa, { withFileTypes: true })) {
        const ut = `${mappa}/${b.name}`;
        const rel = elotag ? `${elotag}/${b.name}` : b.name;
        if (b.isDirectory()) { bejar(ut, rel); continue; }
        if (!b.name.endsWith('.js')) continue;
        const forras = readFileSync(ut, 'utf8');
        // Template literálok, amikben SQL-kulcsszó van
        for (const m of forras.matchAll(/`([^`]*)`/g)) {
          const tartalom = m[1];
          if (!/\b(SELECT|INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i.test(tartalom)) continue;
          for (const sor of tartalom.split('\n')) {
            if (/^\s*\/\//.test(sor)) {
              talalatok.push(`${rel}: ${sor.trim().slice(0, 70)}`);
            }
          }
        }
      }
    };
    bejar(`${__dirname}/../src`);

    expect(
      talalatok,
      `JS-komment (//) SQL-lekérdezés belsejében:\n  ${talalatok.join('\n  ')}\n\n`
      + 'Az SQL-ben a komment `--`. A `//` szintaktikai hibát okoz, amit egy\n'
      + 'try/catch könnyen elnyel — a lekérdezés némán soha nem fut le.',
    ).toEqual([]);
  });
});
