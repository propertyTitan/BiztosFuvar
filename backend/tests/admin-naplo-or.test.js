// =====================================================================
//  ADMIN-NAPLÓ ŐR (2026-08-11)
//
//  ⚠️ A MINTA HARMADSZOR IS MEGISMÉTLŐDÖTT. Az admin-hozzáférési napló öt
//  végponton épült meg — azon az ötön, ahol a hiányt felfedezték. A
//  `GET /admin/bookings` kimaradt, holott a `GET /admin/jobs` PONTOS
//  ikerpárja, és a `/admin/jobs` saját kommentje indokolja a naplózást.
//
//  A projekt máshol már gépesítette ezt a hibaosztályt (route-manifest,
//  scrub-ALLOWLIST, retenciós manifest, PII-csatorna manifest). Az admin
//  oldalon nem volt ilyen — pedig itt EGY kérés 100-200 ember teljes
//  elérhetőségét adja.
//
//  Az őr FUTÁSIDŐBEN olvassa a hívási láncot az Express router-stackből,
//  nem forrásszövegből.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { expressApp } = require('./helpers');
const { listRoutes } = require('./routeInventory');
const { ADMIN_NAPLO_MANIFEST } = require('./adminNaploManifest');

const NAPLO = 'logAdminAccess';

/**
 * Minden ADMIN-KÉPES GET — a hívási lánc alapján, NEM útvonal-prefix szerint.
 *
 * ⚠️ 2026-08-11: az őr korábban `path.startsWith('/admin/')`-gal szűrt, ezért
 * MINDEN admin-képes végpont, ami nem az `/admin/` alatt lakik, láthatatlan
 * volt neki — köztük a `GET /payments/admin/log`, ami NEM naplózott, és a
 * `GET /disputes` admin-ága, ami csak véletlenül naplózott (az őr nem
 * kényszerítette). Ugyanaz a hibaosztály, amit ez az őr ünnepel a
 * fejlécében — csak egy szinttel feljebb.
 */
function adminGetek() {
  return listRoutes(expressApp).filter(
    (r) => r.method === 'GET'
      && (r.path.startsWith('/admin/')
        || r.middlewares.some((m) => /^(adminOnly|requireRole)/.test(m))
        || r.path.includes('/admin/')),
  );
}

describe('Admin-napló őr', () => {
  it('minden admin GET-végpont be van sorolva', () => {
    const utak = adminGetek();
    expect(utak.length, 'nem sikerült kiolvasni az admin-végpontokat — az őr vak').toBeGreaterThan(8);

    const hianyzo = utak
      .map((r) => `${r.method} ${r.path}`)
      .filter((k) => !ADMIN_NAPLO_MANIFEST[k]);

    expect(
      hianyzo,
      `Ezek az admin-végpontok nincsenek besorolva:\n  ${hianyzo.join('\n  ')}\n\n`
      + 'Döntsd el, ad-e vissza MÁS felhasználók személyes adatát:\n'
      + '  naplozando — igen → logAdminAccess KÖTELEZŐ\n'
      + '  kivetel    — nem, indoklással\n\n'
      + 'Egy kérés itt 100-200 ember teljes elérhetőségét adhatja. A GDPR '
      + '5. cikk (2) szerint azt is tudni kell, KI nézte meg.',
    ).toEqual([]);
  });

  it('a „naplozando" végpontokon a naplózás FUTÁSIDŐBEN rajta van', () => {
    const nemNaploz = adminGetek()
      .filter((r) => ADMIN_NAPLO_MANIFEST[`${r.method} ${r.path}`] === 'naplozando')
      .filter((r) => !r.middlewares.includes(NAPLO))
      // A naplózás lehet a handler TÖRZSÉBEN is (nem middleware-ként) —
      // ilyenkor a forrásból ellenőrizzük, hogy tényleg meghívja-e.
      .filter((r) => !handlerNaploz(r.path))
      .map((r) => `${r.method} ${r.path}`);

    expect(
      nemNaploz,
      `Ezek MÁS felhasználók adatát adják vissza, de nem hagynak nyomot:\n  ${nemNaploz.join('\n  ')}\n\n`
      + 'Tedd rá a logAdminAccess hívást. Ez pontosan az a hiba, ami a '
      + '/admin/bookings-nál megtörtént: a /admin/jobs ikerpárja naplózott, ez nem.',
    ).toEqual([]);
  });

  it('a kivételek indoklása érdemi', () => {
    for (const [k, v] of Object.entries(ADMIN_NAPLO_MANIFEST)) {
      if (typeof v === 'string') continue;
      expect(
        typeof v.kivetel === 'string' && v.kivetel.length > 40,
        `A(z) "${k}" kivétel-indoklása túl rövid. Írd le, MIÉRT nem ad vissza `
        + 'más felhasználók személyes adatát.',
      ).toBe(true);
    }
  });

  it('a manifest nem avulhat el', () => {
    const letezo = new Set(adminGetek().map((r) => `${r.method} ${r.path}`));
    const felesleges = Object.keys(ADMIN_NAPLO_MANIFEST).filter((k) => !letezo.has(k));
    expect(felesleges, `Nem létező végpont a manifestben: ${felesleges.join(', ')}`).toEqual([]);
  });
});

/**
 * A handler törzsében szerepel-e a naplózás?
 *
 * A naplózás lehet middleware-ként (a hívási láncban látszik) VAGY a handler
 * törzsének első soraiban. Ez a függvény az utóbbit nézi: megkeresi a
 * route-regisztrációt, és a KÖVETKEZŐ route-regisztrációig terjedő szakaszban
 * keresi a hívást — így nem kell találgatni a blokk hosszát.
 */
function handlerNaploz(utvonal) {
  const { readFileSync, readdirSync } = require('fs');
  const dir = `${__dirname}/../src/routes`;

  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const forras = readFileSync(`${dir}/${f}`, 'utf8');
    // A route lehet teljes útvonallal vagy mount-prefix nélkül regisztrálva.
    for (const jelolt of [utvonal, utvonal.replace(/^\/admin/, '')]) {
      const kezd = forras.indexOf(`router.get('${jelolt}'`);
      if (kezd === -1) continue;
      const kov = forras.indexOf('\nrouter.', kezd + 1);
      const blokk = forras.slice(kezd, kov === -1 ? forras.length : kov);
      if (blokk.includes(NAPLO)) return true;
    }
  }
  return false;
}
