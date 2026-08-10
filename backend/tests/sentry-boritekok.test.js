// =====================================================================
//  SENTRY-BORÍTÉKOK — OSZTÁLY-SZINTŰ ŐR (2026-08-10)
//
//  ⚠️ EZ A TESZT EGY MEGISMÉTELT HIBÁBÓL SZÜLETETT.
//
//  2026-08-09 reggel javítottuk, hogy a kimenő hívások query stringje (az
//  ÉLES SeeMe API-kulcs, a 6 jegyű átvételi kód, telefonszámok) ne mehessen
//  ki a Sentrybe. A javítás a BREADCRUMB-ot zárta le, és írtunk hozzá egy
//  őrt, ami az SDK forrásából olvassa ki a breadcrumb MEZŐNEVEIT. Zöld lett.
//
//  Csakhogy ugyanaz az adat MÁSIK BORÍTÉKBAN is elhagyja a rendszert: a
//  `beforeSend` KIZÁRÓLAG hiba-eseményen fut (@sentry/core client.js:
//  `if (isErrorEvent(processedEvent) && beforeSend)`), a teljesítmény-
//  események (tracesSampleRate) viszont a `beforeSendSpan` /
//  `beforeSendTransaction` hookokon mennek — amiket nem állítottunk be.
//  A kimenő fetch spanjének attribútumai közt ott a teljes URL query-vel
//  (`url.full`) és a nyers query string (`url.query`).
//
//  A TANULSÁG: rossz kérdést tettünk fel. Nem az a kérdés, hogy „milyen
//  MEZŐKET ír az SDK", hanem hogy „HÁNYFÉLE BORÍTÉKBAN hagyhatja el ugyanaz
//  az adat a rendszert". Ez az őr ezért a BORÍTÉKOKAT számolja: kiolvassa az
//  SDK-ból, hány `beforeSend*` hookot ismer, és megköveteli, hogy
//  mindegyikre legyen szűrőnk — mindhárom init-fájlban.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
  scrubSentrySpan, scrubSentryTransaction, REDACTED,
} = require('../src/utils/sentryScrub');

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const SDK_CLIENT = p('../node_modules/@sentry/core/build/cjs/client.js');

// Ahol Sentry-t inicializálunk. Mindháromnak ugyanazt kell tudnia.
const INIT_FAJLOK = [
  p('../src/index.js'),
  p('../../web/sentry.client.config.ts'),
  p('../../web/sentry.server.config.ts'),
];

// A valódi SeeMe-hívás query stringje (services/sms.js).
const SEEME_QUERY = '?key=ELES-KULCS-XYZ&message=Atveteli+kod%3A+384712&number=36309998877';

describe('Span-boríték: a kimenő hívás query stringje nem megy ki', () => {
  it('a span attribútumaiból eltűnik a kulcs, a kód és a telefonszám', () => {
    // A @sentry/node undici-instrumentation pontos alakja:
    const span = {
      description: 'GET https://seeme.hu/gateway',
      op: 'http.client',
      data: {
        'http.request.method': 'GET',
        'url.full': `https://seeme.hu/gateway${SEEME_QUERY}`,
        'url.path': '/gateway',
        'url.query': SEEME_QUERY,
        'url.scheme': 'https',
      },
    };

    const szoveg = JSON.stringify(scrubSentrySpan(span));

    expect(szoveg, 'az ÉLES SeeMe-kulcs kiment a teljesítmény-eseményben').not.toContain('ELES-KULCS-XYZ');
    expect(szoveg, 'a 6 jegyű ÁTVÉTELI KÓD kiment').not.toContain('384712');
    expect(szoveg, 'a címzett telefonszáma kiment').not.toContain('36309998877');
    expect(szoveg, 'a hívott szolgáltató is eltűnt — használhatatlan a nyom').toContain('seeme.hu');
  });

  it('a tranzakció beágyazott spanjei is szűrve vannak', () => {
    const event = {
      type: 'transaction',
      transaction: '/jelszo-reset',
      request: { url: 'https://gofuvar.hu/jelszo-reset?token=ELO-TOKEN-123' },
      spans: [{ description: 'GET https://nominatim.org/search', data: { 'url.query': '?q=Fo+utca+12' } }],
    };

    const szoveg = JSON.stringify(scrubSentryTransaction(event));

    expect(szoveg, 'a jelszó-reset ÉLŐ tokenje kiment a tranzakcióban').not.toContain('ELO-TOKEN-123');
    expect(szoveg, 'a begépelt cím kiment a beágyazott spanben').not.toContain('Fo+utca');
    expect(szoveg).toContain(REDACTED);
  });
});

// ⚠️ EZ AZ ŐR A SUITE LÉNYEGE — ez az, ami hiányzott.
describe('Őr: MINDEN Sentry-borítékra van szűrőnk', () => {
  it('az SDK által ismert összes beforeSend* hook be van állítva, minden init-fájlban', () => {
    expect(
      existsSync(SDK_CLIENT),
      `A Sentry core kliense nem található (${SDK_CLIENT}). Ha a csomag átszerveződött, `
      + 'ezt az őrt az ÚJ útvonalra kell igazítani — vakon hagyni nem szabad.',
    ).toBe(true);

    const forras = readFileSync(SDK_CLIENT, 'utf8');

    // Az SDK a `processBeforeSend`-ben olvassa ki az options-ből, milyen
    // hookokat ismer. Innen szedjük ki a nevüket — nem kézzel soroljuk fel.
    const hookok = new Set();
    for (const m of forras.matchAll(/\boptions\.(beforeSend\w*)/g)) hookok.add(m[1]);
    const destrukturalt = forras.match(/const \{([^}]*beforeSend[^}]*)\} = options;/);
    if (destrukturalt) {
      for (const m of destrukturalt[1].matchAll(/\b(beforeSend\w*)/g)) hookok.add(m[1]);
    }

    expect(
      hookok.size,
      'nem sikerült kiolvasni a Sentry hook-neveit az SDK-ból — az őr vak lenne',
    ).toBeGreaterThanOrEqual(3);

    for (const fajl of INIT_FAJLOK) {
      const init = readFileSync(fajl, 'utf8');
      const hianyzo = [...hookok].filter((h) => !init.includes(`${h}:`));
      expect(
        hianyzo,
        `A Sentry SDK ismer olyan borítékot, amire ebben az init-fájlban nincs szűrő:\n`
        + `  fájl: ${fajl}\n`
        + `  hiányzó hook(ok): ${hianyzo.join(', ')}\n\n`
        + 'Ez PONTOSAN az a hiba, ami 2026-08-09-én megtörtént: a beforeSend csak a\n'
        + 'HIBA-eseményre fut, a teljesítmény-események (span/transaction) másik\n'
        + 'borítékban viszik ugyanazt az adatot. Állítsd be a hiányzó hookot a\n'
        + 'megfelelő scrub-függvénnyel (utils/sentryScrub.js), vagy ha egy hook\n'
        + 'bizonyítottan nem hordozhat személyes adatot, dokumentáld itt, miért.',
      ).toEqual([]);
    }
  });

  it('a teljesítmény-mérés tényleg be van kapcsolva (különben az őr tárgytalan volna)', () => {
    // Ha valaki kiveszi a tracesSampleRate-et, a span-boríték eltűnik — de az
    // őr ettől még értelmes marad. Ez csak dokumentálja a mai állapotot.
    const init = readFileSync(INIT_FAJLOK[0], 'utf8');
    expect(init).toContain('tracesSampleRate');
  });
});
