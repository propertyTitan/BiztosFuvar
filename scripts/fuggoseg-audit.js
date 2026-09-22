#!/usr/bin/env node
/* eslint-disable no-console */
// =====================================================================
//  FÜGGŐSÉG-AUDIT ŐR
//
//  Az `npm audit` önmagában vagy mindent átenged, vagy mindenre pirosít —
//  egyik sem használható kapuként. Ez a szkript a projekt máshol is követett
//  elvét viszi végig: ÚJ sérülékenység = piros build, kivéve ha valaki
//  TUDATOSAN, ÍRÁSOS INDOKKAL elfogadta.
//
//  Amit néz:
//    - CSAK a production függőségeket (`--omit=dev`). A teszt- és
//      build-eszközök sosem kerülnek élesbe; egy vitest-sérülékenység nem
//      veszélyezteti a felhasználót, és ha kapuznánk rá, a csapat
//      hozzászokna a piros buildhez — az a legrosszabb, ami történhet.
//    - CSAK a `high` és `critical` szintet. A moderate/low zajt csinálna.
//
//  Használat:  node scripts/fuggoseg-audit.js <könyvtár>
// =====================================================================

const { execSync } = require('child_process');
const path = require('path');

// ── Tudatosan elfogadott sérülékenységek ──────────────────────────────
// Kulcs: a csomag neve. Érték: MIÉRT élhetünk vele — és mi oldaná meg.
// ⚠️ Ide csak indoklással kerülhet be bármi. Ha a helyzet változik
// (pl. self-hosted lesz a web), a bejegyzést törölni kell.
const ELFOGADOTT_CSOMAGONKENT = {
  backend: {
    // Jelenleg nincs elfogadott kivétel — minden magas/kritikus javítva.
  },
  web: {
  },
};

const konyvtar = process.argv[2] || '.';
const nev = path.basename(path.resolve(konyvtar));
const ELFOGADOTT = ELFOGADOTT_CSOMAGONKENT[nev] || {};

let kimenet;
try {
  // Az `npm audit` nem-nulla kóddal lép ki, ha talál valamit — ezért fogjuk el.
  kimenet = execSync('npm audit --omit=dev --json', {
    cwd: konyvtar, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 20 * 1024 * 1024,
  });
} catch (err) {
  // A sérülékenységeket jelző exit 1 feldolgozható; a futtatási hiba nem.
  if (err.status !== 1 || !err.stdout || err.signal) {
    console.error(`[audit] Az npm audit nem futott le (${nev}). Próbáld újra az ellenőrzést.`);
    process.exit(1);
  }
  kimenet = err.stdout;
}

let jelentes;
try {
  jelentes = JSON.parse(kimenet);
  const objektum = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const szintek = ['info', 'low', 'moderate', 'high', 'critical'];
  const m = jelentes?.metadata?.vulnerabilities;
  if (!objektum(jelentes) || jelentes.error || jelentes.auditReportVersion !== 2
      || !objektum(jelentes.vulnerabilities) || !objektum(m)
      || ![...szintek, 'total'].every(k => Number.isSafeInteger(m[k]) && m[k] >= 0)) {
    throw new Error('Érvénytelen auditjelentés');
  }
  const darab = Object.fromEntries(szintek.map(k => [k, 0]));
  for (const v of Object.values(jelentes.vulnerabilities)) {
    if (!objektum(v) || !szintek.includes(v.severity)) throw new Error('Ismeretlen súlyosság');
    darab[v.severity]++;
  }
  if (!szintek.every(k => darab[k] === m[k])
      || m.total !== Object.values(darab).reduce((a, b) => a + b, 0)) {
    throw new Error('Hiányos auditjelentés');
  }
} catch {
  // Registry/proxy hibaüzenetét nem szabad nulla találatos auditnak tekinteni.
  console.error(`[audit] Nem kaptunk teljes, érvényes npm audit jelentést (${nev}). Az ellenőrzés sikertelen.`);
  process.exit(1);
}

const sulyosak = Object.entries(jelentes.vulnerabilities)
  .filter(([, v]) => v.severity === 'high' || v.severity === 'critical');

const ujak = sulyosak.filter(([csomag]) => !ELFOGADOTT[csomag]);
const ismertek = sulyosak.filter(([csomag]) => ELFOGADOTT[csomag]);

console.log(`\n── Függőség-audit: ${nev} (csak production) ──`);
const m = jelentes.metadata?.vulnerabilities || {};
console.log(`   összes: high=${m.high ?? 0} critical=${m.critical ?? 0} `
  + `(moderate=${m.moderate ?? 0}, low=${m.low ?? 0} — ezekre nem kapuzunk)`);

if (ismertek.length) {
  console.log('\n   Tudatosan elfogadott:');
  for (const [csomag, v] of ismertek) {
    console.log(`     · ${csomag} (${v.severity}) — ${ELFOGADOTT[csomag].ok}`);
    console.log(`       megoldás: ${ELFOGADOTT[csomag].megoldas}`);
  }
}

// A lista ne rohadjon el: ha egy elfogadott tétel MÁR NEM sérülékeny,
// szóljunk, hogy törölni kell — különben a következő ember azt hiszi,
// még mindig él a kockázat, és nem meri frissíteni a csomagot.
const elavult = Object.keys(ELFOGADOTT).filter((cs) => !jelentes.vulnerabilities?.[cs]);

if (ujak.length === 0) {
  if (elavult.length) {
    console.log(`\n   ℹ️  Már nem sérülékeny, törölhető a listáról: ${elavult.join(', ')}`);
  }
  console.log('\n   ✔ Nincs ÚJ magas/kritikus sérülékenység éles függőségben.\n');
  process.exit(0);
}

console.log('\n   ✗ ÚJ MAGAS/KRITIKUS SÉRÜLÉKENYSÉG ÉLES FÜGGŐSÉGBEN:\n');
for (const [csomag, v] of ujak) {
  const via = Array.isArray(v.via) ? v.via.find((x) => typeof x === 'object') : null;
  console.log(`     · ${csomag} — ${v.severity.toUpperCase()}`);
  if (via?.title) console.log(`       ${via.title}`);
  if (via?.url) console.log(`       ${via.url}`);
  const fix = v.fixAvailable;
  console.log(`       javítás: ${fix === true ? '`npm audit fix` elég'
    : fix ? `${fix.name}@${fix.version}${fix.isSemVerMajor ? ' (FŐ VERZIÓUGRÁS)' : ''}`
    : 'egyelőre nincs'}`);
}
console.log('\n   Teendő: futtasd az `npm audit fix`-et, VAGY — ha nem érint minket —');
console.log('   vedd fel a scripts/fuggoseg-audit.js ELFOGADOTT listájára INDOKLÁSSAL.\n');
process.exit(1);
