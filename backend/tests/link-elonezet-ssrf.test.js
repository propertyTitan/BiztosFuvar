// =====================================================================
//  LINK-ELŐNÉZET: SSRF-FELÜLET (2026-08-12)
//
//  ⚠️ EZ A FÁJL 0%-OS ELÁGAZÁS-LEFEDETTSÉGEN ÁLLT — és ez az EGYETLEN
//  végpontunk, ami a felhasználó által megadott URL-t TÖLTI LE a szerverről.
//  Vagyis pontosan az SSRF-felület.
//
//  A CLAUDE.md szerint „az SSRF-felület (link-preview host-allowlist)
//  ELLENŐRIZVE ÉS RENDBEN" — de az ÁTOLVASÁSSAL volt ellenőrizve, nem
//  méréssel. A védelem valóban jól van megírva; ez a fájl azt bizonyítja,
//  hogy MŰKÖDIK is, és hogy egy jövőbeli átírás nem tudja némán kinyitni.
//
//  Amit véd: a szerver a belső hálózatot (169.254.169.254 felhő-metaadat,
//  127.0.0.1, 10.x) nem kérdezheti le a felhasználó kérésére — se közvetlenül,
//  se ÁTIRÁNYÍTÁSON keresztül, se protokoll-váltással.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { app, createUser } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

let user;
let hivottUrlek;

beforeEach(async () => {
  __resetRateLimitsForTests();
  user = await createUser({ role: 'shipper' });
  hivottUrlek = [];
  // Minden kimenő kérést rögzítünk — így MÉRHETŐ, hogy a szerver
  // egyáltalán megpróbálta-e letölteni a tiltott címet.
  vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
    hivottUrlek.push(String(url));
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      text: async () => '<html><head><meta property="og:title" content="Teszt"></head></html>',
    };
  });
});
afterEach(() => { vi.restoreAllMocks(); });

const elonezet = (url) => request(app)
  .get(`/link-preview?url=${encodeURIComponent(url)}`)
  .set('Authorization', `Bearer ${user.token}`);

describe('Link-előnézet: SSRF-védelem', () => {
  it('BELSŐ hálózati címet meg sem próbál letölteni', async () => {
    const belsok = [
      'http://169.254.169.254/latest/meta-data/',   // AWS/felhő metaadat
      'http://127.0.0.1:5432/',                      // helyi Postgres
      'http://localhost/admin',
      'http://10.0.0.1/',
      'http://[::1]/',
      'http://192.168.1.1/',
    ];
    for (const cim of belsok) {
      const res = await elonezet(cim);
      // A tiltott hoszt 400 + UNSUPPORTED_LINK — ez erősebb elutasítás, mint
      // az `ok:false` (ott már megtörtént a letöltési kísérlet).
      expect(
        res.status,
        `${cim}: NEM utasítottuk el (HTTP ${res.status}) — belső cím előnézete!`,
      ).toBe(400);
      expect(res.body.code).toBe('UNSUPPORTED_LINK');
    }
    expect(
      hivottUrlek,
      `A SZERVER MEGPRÓBÁLTA LETÖLTENI a belső címeket:\n  ${hivottUrlek.join('\n  ')}\n\n`
      + 'Ez SSRF: a támadó a mi szerverünkkel kérdezteti le a felhő-metaadat\n'
      + 'szolgáltatást (ahol a hitelesítő adatok vannak) vagy a belső hálózatot.\n'
      + 'A host-allowlistnek a KÉRÉS ELŐTT kell szűrnie.',
    ).toEqual([]);
  });

  it('nem HTTP protokollt elutasít (file://, gopher://, data:)', async () => {
    for (const cim of ['file:///etc/passwd', 'gopher://127.0.0.1:11211/', 'data:text/html,<b>x', 'ftp://ikea.com/']) {
      const res = await elonezet(cim);
      expect(res.status, `${cim}: elfogadtuk (HTTP ${res.status})!`).toBe(400);
    }
    expect(hivottUrlek, 'nem-HTTP protokollra is elindítottunk kérést').toEqual([]);
  });

  it('ismeretlen hosztot elutasít, akkor is ha az engedélyezettre HASONLÍT', async () => {
    const csalok = [
      'https://ikea.com.tamado.hu/termek',      // az allowlist NEM prefix-illesztés
      'https://evil.hu/?x=ikea.com',
      'https://not-ikea.com/termek',
      'https://ikea.com.evil.hu/',
      'https://xn--ikea-0na.com/',              // homográf
    ];
    for (const cim of csalok) {
      const res = await elonezet(cim);
      expect(res.status, `${cim}: átment az allowlisten (HTTP ${res.status})!`).toBe(400);
    }
    expect(
      hivottUrlek,
      `Az allowlist megkerülhető volt hasonló hoszttal:\n  ${hivottUrlek.join('\n  ')}`,
    ).toEqual([]);
  });

  it('ENGEDÉLYEZETT hoszton viszont működik (a védelem nem túl széles)', async () => {
    const res = await elonezet('https://www.ikea.com/hu/hu/p/termek-123/');
    expect(res.status).toBe(200);
    expect(
      hivottUrlek.length,
      'Az engedélyezett hosztot sem töltöttük le — a funkció használhatatlan lenne.',
    ).toBeGreaterThan(0);
    expect(res.body.source).toBe('IKEA');
  });

  it('ÁTIRÁNYÍTÁS nem viheti ki az allowlistről', async () => {
    // Az engedélyezett hoszt 302-vel egy belső címre küld.
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      hivottUrlek.push(String(url));
      if (String(url).includes('ikea.com')) {
        return {
          ok: false, status: 302,
          headers: { get: (h) => (h.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
          text: async () => '',
        };
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        text: async () => '<html><head><meta property="og:title" content="BELSŐ"></head></html>',
      };
    });

    const res = await elonezet('https://www.ikea.com/hu/hu/p/atiranyit/');
    expect(res.body.ok, 'az átirányítás után is adtunk előnézetet').toBe(false);
    expect(
      hivottUrlek.some((u) => u.includes('169.254.169.254')),
      'AZ ÁTIRÁNYÍTÁST KÖVETTÜK a belső címre.\n\n'
      + 'A `redirect: manual` pontosan azért van, hogy MI döntsük el, követjük-e.\n'
      + 'Az allowlistet a Location fejlécre IS alkalmazni kell — különben egy\n'
      + 'engedélyezett hoszt (vagy egy feltört aldomain) kapuvá válik.',
    ).toBe(false);
  });

  it('a protokoll-váltó átirányítást (https → file://) is elutasítja', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
      hivottUrlek.push(String(url));
      return {
        ok: false, status: 301,
        headers: { get: (h) => (h.toLowerCase() === 'location' ? 'file:///etc/passwd' : null) },
        text: async () => '',
      };
    });
    const res = await elonezet('https://www.ikea.com/hu/hu/p/x/');
    expect(res.body.ok).toBe(false);
    expect(hivottUrlek.some((u) => u.startsWith('file:')), 'file:// átirányítást követtünk').toBe(false);
  });

  it('hiányzó vagy szemét URL-paraméterre nem omlik össze', async () => {
    for (const rossz of ['', '   ', 'nem-url', '://', 'https://', String.raw`https://ikea.com/\..\..\etc`]) {
      const res = await request(app)
        .get(`/link-preview?url=${encodeURIComponent(rossz)}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(res.status, `"${rossz}" → 5xx`).toBeLessThan(500);
    }
  });

  it('hálózati hiba / timeout esetén is válaszol (nem akad el)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const res = await elonezet('https://www.ikea.com/hu/hu/p/x/');
    expect(res.status).toBe(200);
    expect(
      res.body.ok,
      'timeoutnál is „sikeres" előnézetet adtunk',
    ).toBe(false);
  });
});
