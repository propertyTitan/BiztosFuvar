#!/usr/bin/env node
/* eslint-disable no-console */
// =====================================================================
//  LEFEDETTSÉG-ŐR
//
//  Miért nem a vitest beépített `thresholds`-át használjuk: az kiírja ugyan,
//  hogy „does not meet global threshold", de NULLA kilépési kóddal végez —
//  lemérve a build zöld maradt egy 99%-os küszöbbel is. Egy kapu, ami nem
//  kapuz, rosszabb a semminél: hamis biztonságérzetet ad.
//
//  A küszöb NEM CÉL, hanem PADLÓ. A jelenlegi érték alá van hangolva pár
//  százalékkal: nem azt jutalmazza, ha valaki teszt-számot hajszol, hanem
//  azt akadályozza meg, hogy a lefedettség ÉSZREVÉTLENÜL csússzon vissza.
//
//  Használat:  node scripts/lefedettseg-or.js <könyvtár>
// =====================================================================

const fs = require('fs');
const path = require('path');

// ⚠️ MEGEMELVE (2026-08-12, a tesztelő kérésére). A padló mindig a MÉRT
// érték alatt pár ponttal áll — nem célnak, hanem VISSZACSÚSZÁS-védelemnek.
// Előtte: lines 70 / statements 67 / functions 68 / branches 55.
// A mért érték ekkor: lines 89,2 / statements 87 / functions 84 / branches 80,5.
const PADLO = { lines: 85, statements: 83, functions: 80, branches: 77 };

const konyvtar = process.argv[2] || '.';
const riport = path.join(konyvtar, 'coverage', 'coverage-summary.json');

if (!fs.existsSync(riport)) {
  console.error(`[lefedettség] Nincs riport: ${riport}\n`
    + 'Előbb futtasd: npm run test:coverage');
  process.exit(1);
}

// ELAVULT RIPORT ELLENI VÉDELEM. Magam estem bele: `npm test` futtatása után
// néztem a riportot, ami még az ELŐZŐ mérésé volt — és 13 új teszt után is
// változatlan számot mutatott. Egy elavult riport elrejtheti a visszacsúszást,
// ezért inkább elbukunk, mint hogy hamis zöldet adjunk.
const riportKor = fs.statSync(riport).mtimeMs;
const ujabbFajl = ['src', 'tests']
  .map((d) => path.join(konyvtar, d))
  .filter((d) => fs.existsSync(d))
  .flatMap(function bejar(d) {
    return fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => {
      const teljes = path.join(d, f.name);
      if (f.isDirectory()) return bejar(teljes);
      return fs.statSync(teljes).mtimeMs > riportKor ? [teljes] : [];
    });
  });

if (ujabbFajl.length) {
  console.error(`\n[lefedettség] A riport ELAVULT: ${ujabbFajl.length} fájl újabb nála`);
  console.error(`   (pl. ${path.relative(konyvtar, ujabbFajl[0])})`);
  console.error('   Futtasd újra: npm run test:coverage\n');
  process.exit(1);
}

const osszes = JSON.parse(fs.readFileSync(riport, 'utf8')).total;

console.log(`\n── Lefedettség: ${path.basename(path.resolve(konyvtar))} ──`);
const bukott = [];
for (const [kulcs, padlo] of Object.entries(PADLO)) {
  const ertek = osszes[kulcs]?.pct ?? 0;
  const jel = ertek >= padlo ? '✔' : '✗';
  console.log(`   ${jel} ${kulcs.padEnd(11)} ${ertek.toFixed(2)}%  (padló: ${padlo}%)`);
  if (ertek < padlo) bukott.push(`${kulcs}: ${ertek.toFixed(2)}% < ${padlo}%`);
}

if (bukott.length) {
  console.error('\n   ✗ A LEFEDETTSÉG VISSZACSÚSZOTT:\n     ' + bukott.join('\n     '));
  console.error('\n   Vagy írj tesztet az új kódra, vagy — ha tudatos a döntés —');
  console.error('   hangold át a padlót a scripts/lefedettseg-or.js-ben, indoklással.\n');
  process.exit(1);
}
console.log('\n   ✔ A lefedettség nem csúszott vissza.\n');
