// =====================================================================
//  SENTRY BREADCRUMB — a kimenő hívások query stringje (2026-08-09)
//
//  Adatáramlási audit, KRITIKUS találat. A Sentry Node SDK MINDEN kimenő
//  fetch-ről breadcrumbot ír, és a NYERS query stringet külön mezőbe
//  (`http.query`) teszi. A mi szűrőnk viszont mezőneveket sorolt fel
//  (url/to/from) — a `http.query`-t nem érte el.
//
//  Élesben ez a SeeMe SMS-gateway-en bukott volna meg: az GET-es, tehát a
//  query stringbe kerül az ÉLES API-kulcs, a címzett telefonszáma és a
//  teljes SMS-szöveg — benne a 6 jegyű ÁTVÉTELI KÓDDAL és a szállító
//  nevével/telefonjával. És épp az az SMS-hiba riasztás küldi ki, amit erre
//  az esetre írtunk (sms.js reportSmsFailure): SeeMe-elutasításkor
//  (code=13, elfordult IP — a CLAUDE.md szerint VÁRT hibamód) a
//  Sentry-esemény a breadcrumbbal együtt megy ki.
//
//  ⚠️ AMIÉRT EZ MEGTÖRTÉNHETETT: a régi teszt ZÖLD volt — de kézzel írt
//  fixtúrán, ami nem egyezett azzal, amit a valódi SDK termel. Ezért ez a
//  suite (a) a VALÓDI SDK-alakot használja, és (b) tartalmaz egy őrt, ami
//  az SDK FORRÁSÁBÓL olvassa ki a mezőneveket — ha egy SDK-frissítés új
//  mezőt vezet be, a build elhasal, nem pedig némán szivárogni kezd.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { scrubSentryEvent, REDACTED } = require('../src/utils/sentryScrub');

// A csomag `exports` mezője tiltja a mély require-t, ezért fájlrendszerből.
const SDK_FORRAS = fileURLToPath(new URL(
  '../node_modules/@sentry/node-core/build/cjs/utils/outgoingFetchRequest.js',
  import.meta.url,
));

/** A VALÓDI SeeMe-hívás, ahogy a services/sms.js összeállítja. */
const SEEME_QUERY = '?key=ELES-SEEME-KULCS-123&message=GoFuvar%3A+uton+a+csomagod%21+Atveteli+kod%3A+384712.+Szallito%3A+Kovacs+Janos+%28%2B36301234567%29&number=36309998877';

/** A Sentry Node SDK pontos breadcrumb-alakja (getBreadcrumbData). */
function valodiBreadcrumb(url, search) {
  const data = { url, 'http.method': 'GET' };
  if (search) data['http.query'] = search;
  return { category: 'http', type: 'http', data };
}

describe('Kimenő hívás breadcrumbja nem viheti ki a titkot', () => {
  it('a SeeMe API-kulcs, az SMS szövege és a címzett telefonszáma NEM megy ki', () => {
    const event = {
      breadcrumbs: [valodiBreadcrumb('https://seeme.hu/gateway', SEEME_QUERY)],
    };

    const eredmeny = scrubSentryEvent(event);
    const szoveg = JSON.stringify(eredmeny);

    expect(szoveg, 'az ÉLES SeeMe API-kulcs kiment a Sentrybe').not.toContain('ELES-SEEME-KULCS');
    expect(szoveg, 'a 6 jegyű ÁTVÉTELI KÓD kiment a Sentrybe').not.toContain('384712');
    expect(szoveg, 'a szállító neve kiment a Sentrybe').not.toContain('Kovacs');
    expect(szoveg, 'a címzett telefonszáma kiment a Sentrybe').not.toContain('36309998877');
    // A hibakereséshez szükséges rész viszont megmarad:
    expect(szoveg, 'a hívott szolgáltató neve is eltűnt — így használhatatlan a napló').toContain('seeme.hu');
  });

  it('a geokódolt CÍM (Nominatim ?q=) sem megy ki', () => {
    const event = {
      breadcrumbs: [valodiBreadcrumb(
        'https://nominatim.openstreetmap.org/search',
        '?format=json&limit=1&q=Hodmezovasarhely%2C+Szanto+Kovacs+Janos+utca+144',
      )],
    };
    const szoveg = JSON.stringify(scrubSentryEvent(event));
    expect(szoveg, 'a felhasználó által begépelt cím kiment a Sentrybe').not.toContain('Szanto');
  });

  it('az ADÓSZÁM sem megy ki (a VIES az ÚTVONALBA teszi, nem query-be)', () => {
    const event = {
      breadcrumbs: [valodiBreadcrumb(
        'https://ec.europa.eu/taxation_customs/vies/rest-api/ms/HU/vat/24750792', '',
      )],
    };
    const szoveg = JSON.stringify(scrubSentryEvent(event));
    expect(szoveg, 'az adószám kiment a Sentrybe').not.toContain('24750792');
  });

  it('a saját kérésünk URL-jén a hasznos query MEGMARAD (csak a token takarva)', () => {
    // A breadcrumbnál mindent eldobunk, de a SAJÁT kérésünk URL-jén a
    // hibakereséshez kellenek a paraméterek — ott paraméter-szintű a szűrés.
    const event = { request: { url: 'https://api.gofuvar.hu/jobs?status=bidding&token=TITKOS' } };
    const eredmeny = scrubSentryEvent(event);
    expect(eredmeny.request.url).toContain('status=bidding');
    expect(eredmeny.request.url).toContain(REDACTED);
    expect(eredmeny.request.url).not.toContain('TITKOS');
  });
});

// ⚠️ EZ AZ ŐR A SUITE LÉNYEGE.
// A korábbi teszt azért volt hamis zöld, mert kézzel írt fixtúrán futott.
// Ez az őr a TELEPÍTETT SDK forrásából olvassa ki, milyen kulcsokat ír a
// breadcrumb `data` objektumába, és megköveteli, hogy mindegyik vagy a
// szűrőnk hatálya alá essen, vagy szerepeljen az ártalmatlanként MEGINDOKOLT
// listán. Egy SDK-frissítés, ami új mezőt vezet be, így pirosra váltja a
// buildet — nem pedig némán szivárogni kezd.
describe('Őr: az SDK breadcrumb-mezői le vannak fedve', () => {
  // Ezek nem hordozhatnak PII-t, ezért nem szűrjük őket.
  const ARTALMATLAN = ['http.method', 'method', 'status_code'];
  const URL_LIKE_KEY_RE = /(^|\.)(url|to|from|query|fragment|href|link)$/i;

  it('minden mező vagy szűrt, vagy indokoltan ártalmatlan', () => {
    expect(
      existsSync(SDK_FORRAS),
      `Az SDK breadcrumb-forrása nem található (${SDK_FORRAS}). Ha a Sentry `
      + 'átszervezte a csomagot, ezt az őrt az ÚJ útvonalra kell igazítani — '
      + 'némán vakon hagyni nem szabad, mert épp ez a teszt lényege.',
    ).toBe(true);
    const forras = readFileSync(SDK_FORRAS, 'utf8');
    const kulcsok = new Set();

    // data["kulcs"] = … alak
    for (const m of forras.matchAll(/data\[["'`]([^"'`]+)["'`]\]\s*=/g)) kulcsok.add(m[1]);
    // const data = { kulcs: …, "kulcs": … } alak
    const objBlokk = forras.match(/const data = \{([\s\S]*?)\};/);
    if (objBlokk) {
      for (const m of objBlokk[1].matchAll(/["'`]?([\w.]+)["'`]?\s*:/g)) kulcsok.add(m[1]);
    }

    expect(kulcsok.size, 'nem sikerült kiolvasni az SDK breadcrumb-mezőit — az őr vak').toBeGreaterThan(2);

    const fedetlen = [...kulcsok].filter(
      (k) => !URL_LIKE_KEY_RE.test(k) && !ARTALMATLAN.includes(k),
    );
    expect(
      fedetlen,
      `A Sentry SDK olyan breadcrumb-mezőt ír, amit a scrub nem fed le: ${fedetlen.join(', ')}. `
      + 'Vagy vedd fel a szűrt kulcsok közé (utils/sentryScrub.js URL_LIKE_KEY_RE), '
      + 'vagy — ha bizonyítottan nem hordozhat személyes adatot — az ARTALMATLAN listára, indoklással.',
    ).toEqual([]);
  });
});
