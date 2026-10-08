// =====================================================================
//  MEGSZÓLÍTÁS (UX A13, 2026-10-08): keresztnéven, vesszővel
//
//  A regisztráció magyar névsorrendet kér („Kovács Péter"), a felület a
//  név ELSŐ szavát vette („Szia, Fehér!"), a levelek pedig a teljes nevet
//  vessző nélkül („Szia Kovács Anna!"). Két megvalósítás él (backend
//  utils/nev.js a levelekhez, web lib/nev.ts a felülethez) — ez az őr a
//  kettőt egymáshoz méri, és a levél-forrásokban a régi mintát tiltja.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const { megszolitasNev, szia } = require('../src/utils/nev');

const KORPUSZ = [
  ['Kovács Anna', 'Anna'],
  ['  Kovács   Anna  ', 'Anna'],
  ['Dr. Kovács Anna', 'Anna'],
  ['dr Kovács Anna', 'Anna'],
  ['ifj. Szabó Péter', 'Péter'],
  ['Nagy Anna Mária', 'Anna'],
  ['Kovácsné Nagy Anna', 'Anna'],
  ['Kovács-Nagy Péter', 'Péter'],
  ['Fehér Gábor', 'Gábor'],
  ['Anna', 'Anna'],
  ['Kovács Jánosné', 'Kovács Jánosné'],
  // „né"-re végződő utónév nem házassági névrész (fix2-review).
  ['Kovács René', 'René'],
  ['Kovácsné Szabó René', 'René'],
  ['', ''],
  [null, ''],
  [undefined, ''],
];

describe('megszolitasNev', () => {
  it('a keresztnevet adja (magyar névsorrend)', () => {
    for (const [be, ki] of KORPUSZ) expect(megszolitasNev(be), String(be)).toBe(ki);
  });

  it('szia(): „Szia, Anna!", név nélkül „Szia!"', () => {
    expect(szia('Kovács Anna')).toBe('Szia, Anna!');
    expect(szia(null)).toBe('Szia!');
    expect(szia('   ')).toBe('Szia!');
  });

  it('a web-tükör (web/src/lib/nev.ts) ugyanazt adja', async () => {
    const web = await import('../../web/src/lib/nev.ts');
    for (const [be] of KORPUSZ) {
      expect(web.megszolitasNev(be), `ELCSÚSZOTT: „${be}"`).toBe(megszolitasNev(be));
    }
    expect(web.szia('Kovács Anna')).toBe('Szia, Anna!');
    expect(web.szia(null, 'Feladó')).toBe('Szia, Feladó!');
  });
});

describe('a levelek forrása nem rakja össze kézzel a megszólítást', () => {
  it('nincs „Szia ${…név…}" és „Szia${név ? …}" minta', () => {
    const fajlok = [
      'src/services/email.js', 'src/services/noOfferNudge.js', 'src/services/paymentReminders.js',
      'src/routes/disputes.js', 'src/routes/tracking.js', 'src/routes/photos.js',
    ];
    const hibak = [];
    for (const rel of fajlok) {
      const s = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      const m = s.match(/Szia ?\$\{/g);
      if (m) hibak.push(`${rel}: ${m.length} kézi megszólítás (a szia() helyett)`);
    }
    expect(hibak, hibak.join('\n')).toEqual([]);
  });
});
