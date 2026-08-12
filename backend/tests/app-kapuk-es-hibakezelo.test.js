// =====================================================================
//  AZ APP-SZINTŰ KAPUK ÉS A KÖZPONTI HIBAKEZELŐ (src/index.js)
//
//  Ez a réteg minden kérésre lefut, mégis a legkevésbé tesztelt: a route-ok
//  saját suite-jai a HELYES úton közlekednek, a hibás kérés viszont már a
//  routing ELŐTT eldől. Amit itt mérünk:
//
//   (1) HIBÁS/TÚL NAGY KÉRÉS-TEST → 400 / 413, nem 500. Élesben ez nem
//       elméleti: egy megszakadt mobil-kapcsolat csonka JSON-t küld. 500-ként
//       a felhasználó „Szerverhibát" lát, a Sentry pedig valódi hibaként
//       riaszt rá — a valódi hibák elvesznek a zajban.
//   (2) NULL-BÁJT SZŰRŐ. A Postgres UTF8 oszlopba nem tud 0x00-t írni: a
//       driver hibája nyers 500 lenne bármelyik végponton. A null-bájt ráadásul
//       klasszikus szűrő-megkerülési trükk (a validáció a bájt előtti részt
//       látja, a tároló a mögöttit). Az `abc%00def` alak a
//       hülyebiztos-matrixban benne van — a TESTBE és a QUERY-be ágyazott
//       null-bájt viszont MÁS ágon dől el, és eddig azt semmi nem mérte.
//   (3) A PRIVÁT KYC-FÁJL KAPUJA HTTP-SZINTEN. A `resolvePrivateDiskFile`
//       egységtesztje kész (tarolo-hibaagak), de hogy a ROUTE mit csinál az
//       eredményével — 410 vs 404, és rákerül-e a no-store fejléc egy
//       SZEMÉLYI IGAZOLVÁNY fotójára —, azt nem nézte senki.
//   (4) CORS: enélkül a teljes web-alkalmazás elnémul a böngészőben.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterAll,
} from 'vitest';
import request from 'supertest';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { app } = require('./helpers');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');
const tarolo = require('../src/services/storage');

beforeEach(() => __resetRateLimitsForTests());

// Explicit escape — literális NUL-bájt a forrásban láthatatlan és törékeny
// (egy másolás/formázás némán elnyeli, és a teszt hamis zöldre vált).
const NUL = '\u0000';

const PRIVATE_DIR = path.join(__dirname, '..', 'uploads', 'private');
const letrehozottFajlok = [];
afterAll(() => {
  for (const f of letrehozottFajlok) { try { fs.unlinkSync(f); } catch { /* már nincs */ } }
});

/** Valódi privát (KYC-jellegű) fájl a lemezen + a hozzá tartozó adatok. */
async function privatFajl() {
  const jelolo = await tarolo.savePrivateFile(Buffer.from('SZIGORUAN-BIZALMAS-OKMANY'), 'okmany.jpg', 'image/jpeg');
  const nev = path.basename(jelolo.slice('private:'.length));
  letrehozottFajlok.push(path.join(PRIVATE_DIR, nev));
  const url = await tarolo.getSignedPrivateUrl(jelolo, 600);
  const q = new URLSearchParams(url.split('?')[1]);
  return { nev, url, exp: q.get('exp'), sig: q.get('sig') };
}

/** Ugyanaz az aláírás-képlet, mint a szerveré — tetszőleges lejárattal. */
const alairas = (nev, exp) => crypto
  .createHmac('sha256', process.env.JWT_SECRET).update(`${nev}.${exp}`).digest('hex').slice(0, 32);

// =====================================================================
//  1) HIBÁS ÉS TÚL NAGY KÉRÉS-TEST
// =====================================================================
describe('Központi hibakezelő: a kérésben lévő hiba nem a mi hibánk', () => {
  it('csonka JSON → 400 MALFORMED_BODY (nem 500 „Szerverhiba")', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":"a@b.hu","passwo');

    expect(
      res.status,
      'CSONKA JSON-RA 500-AT ADUNK.\n\n'
      + 'Egy megszakadt mobil-kapcsolat pontosan ilyen kérést küld: a\n'
      + 'felhasználó „Szerverhibát" lát (pedig a szerver hibátlan), a Sentry\n'
      + 'pedig valódi hibaként riaszt — minden ilyen kérésnél újra.',
    ).toBe(400);
    expect(res.body.code).toBe('MALFORMED_BODY');
    expect(res.body.detail, 'belső hibaüzenet szivárgott ki a válaszba').toBeUndefined();
  });

  it('2 MB-nál nagyobb test → 413 PAYLOAD_TOO_LARGE (nem 500)', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.hu', password: 'x'.repeat(3 * 1024 * 1024) }));

    expect(
      res.status,
      'A TÚL NAGY KÉRÉSRE 500 JÖTT.\n\n'
      + 'A méret-plafon védelmi eszköz (memória-kimerítés ellen) — ha 500-zal\n'
      + 'végződik, a támadó nem is tudja, hogy védve vagyunk, mi viszont\n'
      + 'Sentry-riasztást kapunk minden próbálkozásra.',
    ).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('érvénytelen azonosító-formátum → 400 (a Postgres hibája nem szivárog ki)', async () => {
    const res = await request(app).get('/tracking/nem-egy-token-123');
    expect(res.status, 'a hibás formátumú azonosító 500-at okozott').toBeLessThan(500);
    expect(
      JSON.stringify(res.body),
      'BELSŐ ADATBÁZIS-HIBAÜZENET SZIVÁRGOTT KI (SQL/típusnév a válaszban).',
    ).not.toMatch(/invalid input syntax|syntax error|postgres|pg_/i);
  });
});

// =====================================================================
//  2) NULL-BÁJT SZŰRŐ
// =====================================================================
describe('Null-bájt szűrő: egy helyen zárva az egész hibaosztály', () => {
  it('a KÉRÉS-TESTBE ágyazott null-bájt → 400, a DB-ig el sem jut', async () => {
    for (const [nev, body] of [
      ['mező értékében', { title: `ok${NUL}rejtett` }],
      ['mező NEVÉBEN', { [`cim${NUL}`]: 'akármi' }],
      ['tömb elemében', { photos: ['rendben.jpg', `rossz${NUL}.jpg`] }],
      ['beágyazott objektumban', { a: { b: { c: `x${NUL}` } } }],
    ]) {
      const res = await request(app).post('/nincs-ilyen-vegpont')
        .set('Content-Type', 'application/json').send(JSON.stringify(body));
      expect(
        res.status,
        `A null-bájt a testben (${nev}) ÁTMENT a szűrőn.\n\n`
        + 'Ahol a paraméter a DB-ig eljut, a Postgres „invalid byte sequence for\n'
        + 'encoding UTF8: 0x00" hibát dob → nyers 500. Ráadásul a null-bájt\n'
        + 'klasszikus szűrő-megkerülés: a validáció a bájt ELŐTTI részt látja,\n'
        + 'a tároló a mögöttit.',
      ).toBe(400);
      expect(res.body.code).toBe('INVALID_CHARACTER');
    }
  });

  it('az útvonalba írt null-bájt → 400', async () => {
    const res = await request(app).get('/jobs/abc%00def');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_CHARACTER');
  });

  it('HIBÁS %-escape mellett is fog a szűrő (a query-ág védi le)', async () => {
    // A `%ZZ` miatt a teljes URL dekódolása KIVÉTELT dob — ilyenkor a nyers
    // (még kódolt) URL-t látjuk, amiben nincs literális null-bájt. A kérés
    // mégsem mehet tovább: a már dekódolt query-ben ott a 0x00.
    const res = await request(app).get('/health?x=%00&y=%ZZ');
    expect(
      res.status,
      'A HIBÁS %-ESCAPE MEGKERÜLTE A NULL-BÁJT SZŰRŐT.\n\n'
      + 'Elég egy értelmezhetetlen %-szekvenciát tenni az URL-be, és a\n'
      + 'dekódolás kivétele után a null-bájt átcsúszik — a szűrőnek ezért kell\n'
      + 'a nyers URL mellett a dekódolt query-t és a testet is néznie.',
    ).toBe(400);
    expect(res.body.code).toBe('INVALID_CHARACTER');
  });

  it('a szűrő nem túl széles: százalékjel, ékezet, emoji átmegy', async () => {
    const res = await request(app).post('/nincs-ilyen-vegpont')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({
        title: '100% pontos árajánlat — Győr 🚚',
        note: 'árvíztűrő tükörfúrógép',
        // A valós kérésekben rendszeresen van null / szám / logikai érték —
        // a rekurzív bejárásnak ezeken át kell lépnie, nem elakadnia rajtuk.
        recipient_name: null, weight_kg: 12.5, fragile: false, photos: [],
      }));
    expect(
      res.status,
      'ÁRTALMATLAN TARTALMAT IS ELUTASÍT A SZŰRŐ — a magyar szövegek\n'
      + '(ékezet, %, emoji) minden feladási űrlapon előfordulnak.',
    ).not.toBe(400);
  });
});

// =====================================================================
//  3) A PRIVÁT KYC-FÁJL HTTP-KAPUJA
// =====================================================================
describe('/private-files — a KYC-okmány aláírt, lejáró olvasása', () => {
  it('érvényes aláírással megnyílik, és NEM cache-elhető', async () => {
    const { url } = await privatFajl();
    const res = await request(app).get(url);
    expect(res.status, 'a saját magunk által aláírt link nem nyílt meg').toBe(200);
    expect(
      String(res.headers['cache-control']),
      'A SZEMÉLYI IGAZOLVÁNY FOTÓJA CACHE-ELHETŐ VÁLASZBAN MEGY KI.\n\n'
      + 'A no-store nélkül a böngésző (és bármely közbenső proxy) lemezre írja\n'
      + 'az okmányt — a link lejárata után is ott marad, megosztott gépen más\n'
      + 'felhasználó számára is.',
    ).toMatch(/no-store/);
    expect(res.headers['cache-control']).toMatch(/private/);
  });

  it('LEJÁRT link → 410, HAMIS aláírás → 404 (a kettőt nem szabad összemosni)', async () => {
    const { nev } = await privatFajl();

    const mult = String(Math.floor(Date.now() / 1000) - 60);
    const lejart = await request(app).get(`/private-files/${nev}?exp=${mult}&sig=${alairas(nev, mult)}`);
    expect(
      lejart.status,
      'A LEJÁRT LINK MÉG MINDIG KISZOLGÁLJA AZ OKMÁNYT (vagy nem 410-et ad).\n\n'
      + 'A lejárat a presigned R2-URL megfelelője: enélkül egy egyszer kiadott\n'
      + 'admin-link örökre használható maradna.',
    ).toBe(410);

    const jovo = String(Math.floor(Date.now() / 1000) + 600);
    const hamis = await request(app).get(`/private-files/${nev}?exp=${jovo}&sig=${'0'.repeat(32)}`);
    expect(
      hamis.status,
      'HAMIS ALÁÍRÁSSAL MEGNYÍLT (vagy 410-et kapott) A KYC-FÁJL.\n\n'
      + 'A 410 azt üzenné, hogy ilyen link LÉTEZETT, csak elavult — vagyis\n'
      + 'visszajelzést adna a találgatáshoz. Aláírás nélkül a fájl LÉTEZÉSE is titok.',
    ).toBe(404);
  });

  it('találgatott név, útvonal-bejárás és hiányzó lejárat → 404', async () => {
    const esetek = [
      ['nem hex alakú név', '/private-files/akarmi.jpg?exp=9999999999&sig=' + '0'.repeat(32)],
      ['útvonal-bejárás', '/private-files/..%2f..%2fetc%2fpasswd?exp=9999999999&sig=' + '0'.repeat(32)],
      ['hiányzó lejárat', '/private-files/' + 'a'.repeat(32) + '.jpg?sig=' + '0'.repeat(32)],
      ['hiányzó aláírás', '/private-files/' + 'a'.repeat(32) + '.jpg?exp=9999999999'],
    ];
    for (const [nev, ut] of esetek) {
      const res = await request(app).get(ut);
      expect(res.status, `${nev}: nem 404 jött (${res.status})`).toBe(404);
      expect(
        res.text,
        `${nev}: a válasz a fájlrendszerről árulkodik`,
      ).not.toMatch(/root:|\/etc\/passwd/);
    }
  });

  it('a LÉTEZŐ privát fájl a statikus /uploads/private úton NEM érhető el', async () => {
    const { nev, url } = await privatFajl();

    // Bizonyítjuk, hogy a fájl tényleg ott van a lemezen és kiadható…
    expect((await request(app).get(url)).status, 'az aláírt úton sem jött ki a fájl').toBe(200);

    // …a statikus kiszolgálás mégsem adhatja ki.
    const statikus = await request(app).get(`/uploads/private/${nev}`);
    expect(
      statikus.status,
      'A PRIVÁT MAPPÁT AZ EXPRESS.STATIC KISZOLGÁLTA.\n\n'
      + 'Élesben egy R2-kiesés a SZEMÉLYI IGAZOLVÁNY fotóját a lemezre teszi —\n'
      + 'onnan hitelesítés és lejárat nélkül, kitalálható úton lenne letölthető.',
    ).toBe(404);
    expect(statikus.text, 'a privát fájl TARTALMA jött vissza a statikus úton').not.toContain('BIZALMAS');
  });
});

// =====================================================================
//  4) CORS
// =====================================================================
describe('CORS — a böngészőből hívható API', () => {
  it('a válasz visszaadja az origin-t és engedi a hitelesítő adatokat', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://gofuvar.hu');
    expect(res.status).toBe(200);
    expect(
      res.headers['access-control-allow-origin'],
      'NINCS CORS-FEJLÉC A VÁLASZBAN — a böngésző minden API-hívást eldobna,\n'
      + 'a teljes webalkalmazás használhatatlanná válna.',
    ).toBeTruthy();
    expect(
      res.headers['access-control-allow-credentials'],
      'a credentials nincs engedélyezve — a hitelesített kérések elbuknának',
    ).toBe('true');
  });

  it('az előzetes (preflight) kérés megengedi az Authorization fejlécet', async () => {
    const res = await request(app)
      .options('/jobs')
      .set('Origin', 'https://gofuvar.hu')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.status, 'a preflight kérés nem sikerült').toBeLessThan(300);
    expect(
      String(res.headers['access-control-allow-headers'] || '').toLowerCase(),
      'A PREFLIGHT NEM ENGEDI AZ AUTHORIZATION FEJLÉCET — minden bejelentkezett\n'
      + 'kérés elbukna a böngészőben (a curl/teszt viszont működne: ez a hiba\n'
      + 'csak valódi böngészőben látszana).',
    ).toContain('authorization');
  });
});
