// =====================================================================
//  PII-CSATORNA ŐR — a kapu MINDEN egyenértékű úton (2026-08-10)
//
//  ⚠️ EZ AZ ŐR EGY MEGISMÉTELT MINTÁBÓL SZÜLETETT. A független mérés így
//  fogalmazta meg:
//
//      „Egy védelem azon az úton épül meg, ahol felfedezték —
//       az egyenértékű utakon nem."
//
//  A szerver-oldali e-mail-kaput két végpontra tettük rá; ugyanaz az adat
//  (házszámig pontos cím) legalább négy másik úton kiment, az egyiken PUSH-ban.
//
//  Az őr FUTÁSIDŐBEN olvassa a hívási láncot az Express router-stackből — nem
//  forrásszövegből —, tehát nem lehet egy `requireVerifiedEmail` szó
//  odaírásával becsapni.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const { expressApp } = require('./helpers');
const { listRoutes } = require('./routeInventory');
const { PII_CSATORNA_MANIFEST, SOCKET_CSATORNAK } = require('./piiCsatornaManifest');

const KAPU = 'requireVerifiedEmail';

/** Minden hitelesített GET — ezek a MÁSOK adatához vezető olvasási felület. */
function hitelesitettGetek() {
  return listRoutes(expressApp).filter(
    (r) => r.method === 'GET' && r.middlewares.includes('authRequired'),
  );
}

describe('PII-csatorna őr', () => {
  it('minden hitelesített GET-végpont be van sorolva', () => {
    const utak = hitelesitettGetek();
    expect(utak.length, 'nem sikerült kiolvasni a végpontokat — az őr vak').toBeGreaterThan(30);

    const hianyzo = utak
      .map((r) => `${r.method} ${r.path}`)
      .filter((kulcs) => !PII_CSATORNA_MANIFEST[kulcs]);

    expect(
      hianyzo,
      `Ezek a végpontok nincsenek besorolva a PII-csatorna manifestben:\n  ${hianyzo.join('\n  ')}\n\n`
      + 'Döntsd el, MIT ad vissza, és vedd fel a tests/piiCsatornaManifest.js-be:\n'
      + '  sajat   — csak a hívó saját adata\n'
      + '  felek   — egy ügylet felei, külön jogosultság-ellenőrzéssel\n'
      + '  admin   — admin-only\n'
      + '  masok   — MÁS felhasználók adata böngészésre → requireVerifiedEmail KÖTELEZŐ\n'
      + '  kivetel — indoklással, hogy miért nincs kapu\n\n'
      + 'A cél nem a bejegyzés, hanem hogy a döntés TUDATOS legyen.',
    ).toEqual([]);
  });

  it('a „masok" besorolású végpontokon a kapu FUTÁSIDŐBEN rajta van', () => {
    const utak = hitelesitettGetek();
    const kapuNelkul = utak
      .filter((r) => PII_CSATORNA_MANIFEST[`${r.method} ${r.path}`] === 'masok')
      .filter((r) => !r.middlewares.includes(KAPU))
      .map((r) => `${r.method} ${r.path}  (lánc: ${r.middlewares.join(' → ')})`);

    expect(
      kapuNelkul,
      `Ezek MÁSOK adatát adják vissza, de nincs rajtuk a ${KAPU} kapu:\n  ${kapuNelkul.join('\n  ')}\n\n`
      + 'Egy meg nem erősített e-mail-címmel készült fiók tokenje ma is érvényes — '
      + 'a kapu nélkül a teljes felület lapozható vele.',
    ).toEqual([]);
  });

  it('a manifest nem avulhat el: nem sorolhat fel nem létező végpontot', () => {
    const letezo = new Set(hitelesitettGetek().map((r) => `${r.method} ${r.path}`));
    const felesleges = Object.keys(PII_CSATORNA_MANIFEST).filter((k) => !letezo.has(k));
    expect(
      felesleges,
      `A manifest olyan végpontot sorol fel, ami már nem létezik: ${felesleges.join(', ')}. `
      + 'Töröld — az elavult manifest hamis biztonságot ad.',
    ).toEqual([]);
  });

  it('a kivételek indoklása érdemi', () => {
    for (const [kulcs, ertek] of Object.entries(PII_CSATORNA_MANIFEST)) {
      if (typeof ertek === 'string') continue;
      expect(
        typeof ertek.kivetel === 'string' && ertek.kivetel.length > 40,
        `A(z) "${kulcs}" kivétel-indoklása túl rövid vagy hiányzik. Az „nem kell" `
        + 'nem elfogadható: írd le, MIÉRT nem szükséges a kapu.',
      ).toBe(true);
    }
  });

  // ⚠️ A REST-kapu önmagában nem elég: ugyanaz az adat socketen is kimegy.
  it('a socket-szobák belépése ugyanazt a kaput követeli meg', () => {
    const forras = readFileSync(`${__dirname}/../src/realtime.js`, 'utf8');

    for (const [szoba, elvaras] of Object.entries(SOCKET_CSATORNAK)) {
      const belepes = forras.match(
        new RegExp(`socket\\.on\\('${szoba}:join'[\\s\\S]{0,300}?\\}\\);`),
      );
      expect(belepes, `nem találtam a(z) "${szoba}" szoba belépését — az őr vak`).toBeTruthy();
      expect(
        belepes[0],
        `A(z) "${szoba}" socket-szobába belépéshez nem kell ${elvaras.kapu} — `
        + `pedig ${elvaras.indok}. A REST-párja kapuzott, tehát a kapu megkerülhető: `
        + 'elég egy socketet nyitni.',
      ).toContain(elvaras.kapu);
    }
  });

  // Az útvonal-figyelő PUSH-ol: nem kell hozzá lekérdezés sem.
  it('az útvonal-figyelő értesítése csak megerősített fiókhoz megy', () => {
    const forras = readFileSync(`${__dirname}/../src/services/laneAlerts.js`, 'utf8');
    const lekerdezes = forras.slice(forras.indexOf('FROM carrier_alerts'), forras.indexOf('[job.shipper_id]'));
    expect(
      lekerdezes,
      'A lane-alert a HÁZSZÁMIG PONTOS felvételi és lerakodási címet küldi ki '
      + 'értesítésben ÉS e-mailben. Ha nincs benne email_verified feltétel, egy '
      + 'meg nem erősített fiók push-ban kapja meg az összes új fuvar címét — '
      + 'lekérdezni sem kell hozzá, és az e-mail-példány semmilyen retenció alá nem esik.',
    ).toContain('email_verified');
  });
});
