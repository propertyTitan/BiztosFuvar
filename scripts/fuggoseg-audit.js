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
    next: {
      ok: 'A DoS az Image Optimizer ellen SELF-HOSTED telepítést érint. A GoFuvar '
        + 'Vercelen fut, ahol a képoptimalizálás platform-szinten történik, nem a '
        + 'mi Node-folyamatunkban.',
      megoldas: 'Next.js 14 → 16 fő verzióugrás (külön feladat, saját regressziós körrel).',
    },
    postcss: {
      ok: 'Az XSS a CSS-stringify kimenetén keresztül támad, és BUILD IDEJŰ eszköz. '
        + 'A támadónak a fordításkor kellene CSS-t injektálnia — a build a mi '
        + 'repónkból, a mi CI-nkban fut, külső CSS-input nincs.',
      megoldas: 'A Next.js fő verzióugrásával jön a javított postcss.',
    },
  },
};

const konyvtar = process.argv[2] || '.';
const nev = path.basename(path.resolve(konyvtar));
const ELFOGADOTT = ELFOGADOTT_CSOMAGONKENT[nev] || {};

let jelentes;
try {
  // Az `npm audit` nem-nulla kóddal lép ki, ha talál valamit — ezért fogjuk el.
  const kimenet = execSync('npm audit --omit=dev --json', {
    cwd: konyvtar, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 20 * 1024 * 1024,
  });
  jelentes = JSON.parse(kimenet);
} catch (err) {
  if (!err.stdout) {
    console.error(`[audit] Az npm audit nem futott le (${nev}): ${err.message}`);
    process.exit(1);
  }
  jelentes = JSON.parse(err.stdout);
}

const sulyosak = Object.entries(jelentes.vulnerabilities || {})
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
