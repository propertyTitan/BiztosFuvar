// Sentry-esemény PII-szűrés (a launch-kapu checklist 8. pontja).
//
// A Sentry alapból a hibaesemény mellé teszi a teljes HTTP-kérést — fejléc,
// query string ÉS request body. Nálunk ezekben személyes adat utazhat:
//   - body: cím, telefonszám, adószám, chat-üzenet (bármely form-payload)
//   - query/URL: egyszer használatos auth-tokenek (/auth/verify-email?token=,
//     /jelszo-reset?token=) és a publikus tracking-token (/tracking/:token)
//   - fejléc: Authorization JWT, cookie
// Ezért a szabály: a request BODY-t egészében eldobjuk (a hibakereséshez a
// stack trace + URL + metódus elég), a token-jellegű query-paramétereket és
// az útvonalbeli tokeneket kitakarjuk, az auth-fejléceket töröljük.
//
// A függvény tiszta (nincs I/O), sosem dob — hiba esetén az eredeti eseményt
// adja vissza, mert egy elrontott szűrés miatt hibajelentést veszíteni
// rosszabb, mint egy szűretlen esemény.

const REDACTED = '[SZURVE]';

// Query-paraméterek, amelyek titkot hordozhatnak. A `token` a verify/reset
// egyszer használatos tokenje; a többi védekező jellegű (jövőbeli kulcsnevek).
// ⚠️ A koordináták és a kereső-kifejezés is ide tartozik: a
// `/calculator/estimate?pickup_lat=…&pickup_lng=…` a feladó PONTOS
// fel-/lerakodási helyét viszi — még a fuvar létrejötte ELŐTT, űrlapkitöltés
// közben. Az `/admin/users?search=…` pedig épp az az érték, amit az
// admin-naplóból SZÁNDÉKOSAN kihagyunk („a napló nem lehet a PII második
// példánya") — az egyenértékű úton mégis kiment volna.
const SENSITIVE_PARAMS = ['token', 'access_token', 'refresh_token', 'api_key', 'apikey', 'secret', 'password', 'code', 'sig', 'exp',
  'search', 'q', 'lat', 'lng', 'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'email', 'phone'];

// Útvonal-szegmensek, amelyek után titok vagy személyes adat áll.
//   /tracking/<token>  — a publikus követő-link
//   /vat/<adószám>     — a VIES adószám-ellenőrzés az ÚTVONALBA teszi a
//                        számot (services/vat.js), nem query-paraméterbe
// A `/private-files/<név>?exp=…&sig=…` a KYC-okmány dev-fallback olvasó-útja
// (aláírt, lejáró link) — a `sig`/`exp` a SENSITIVE_PARAMS-ban is szerepel.
// ⚠️ A KÉT MEGVALÓSÍTÁS SZÉTCSÚSZOTT (2026-08-11, közös korpusz): innen a
// `/nyomon-kovetes/` (a webes publikus követő-oldal) hiányzott, a webből
// pedig a `/vat/` és a `/private-files/`. Mostantól a lista SZIMMETRIKUS —
// a backend a webes URL-t is láthatja (referer, hibaüzenet, breadcrumb).
const SENSITIVE_PATH_RE = /(\/tracking\/|\/nyomon-kovetes\/|\/vat\/|\/private-files\/)[^/?#]+/gi;

// A breadcrumb-adatok azon kulcsai, amelyekben URL vagy query string állhat.
// A `http.query` a Sentry Node SDK saját mezője: a kimenő fetch NYERS query
// stringjét teszi bele (node-core/utils/outgoingFetchRequest.js) — ezt a
// korábbi, mezőnév-felsoroláson alapuló szűrés nem érte el.
const URL_LIKE_KEY_RE = /(^|\.)(url|to|from|query|fragment|href|link)$/i;

/**
 * URL- vagy query-jellegű ÉRTÉK felismerése — TARTALOM alapján.
 *
 * ⚠️ Miért nem a kulcsnév dönt: a kulcsnév-felsorolás pontosan azt hagyja ki,
 * amire nem gondoltunk. Ezt a saját őrünk mérte ki: az `url.full` kulcs
 * („full" végződés) kimaradt a mintából, pedig épp AZ hordozza a teljes URL-t
 * a query stringgel együtt. A tartalom-alapú felismerés nem felejt.
 */
function urlSzeruErtek(value) {
  if (typeof value !== 'string' || !value) return false;
  return value.includes('://')          // teljes URL
    || /^[?&]/.test(value)              // önálló query string
    || /[?&][\w.%+-]+=/.test(value);   // URL query résszel
}

// ⚠️ NEM CSAK URL-ALAKÚ ADAT SZIVÁROG (2026-08-11, adatáramlási audit).
// A mélybejárás a „HOL keressem" hibamódot megszüntette, de a hely-allowlistet
// ALAK-allowlistre cserélte: csak URL-jellegű stringet írt át. A console-
// breadcrumbök, a kivétel-üzenetek és az `extra` viszont NYERS szöveget
// visznek — pl. a Postgres `detail` mezője:
//     Key (email)=(kovacs.janos@gmail.com) already exists.
// Ezért a szűrés mostantól ALAK-FÜGGETLEN: minden stringből kitakarja az
// e-mail-címet és a telefonszám-alakot, bárhol is áll.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Telefonszám: vezető '+' VAGY elválasztók — így egy sima hosszú szám
// (időbélyeg, azonosító) nem esik áldozatul.
const TELEFON_RE = /(?:\+\d[\d\s\-/().]{7,18}\d|\b06[\s\-/]?\d{1,2}[\s\-/]?\d{3}[\s\-/]?\d{3,4}\b)/g;

/** E-mail és telefonszám kitakarása TETSZŐLEGES szövegből. */
function piiSzures(ertek) {
  if (typeof ertek !== 'string' || !ertek) return ertek;
  return ertek.replace(EMAIL_RE, REDACTED).replace(TELEFON_RE, REDACTED);
}

/** Query string / teljes URL token-paramétereinek kitakarása. */
function scrubUrlLike(value) {
  if (typeof value !== 'string' || !value) return value;
  let out = value.replace(SENSITIVE_PATH_RE, `$1${REDACTED}`);
  for (const param of SENSITIVE_PARAMS) {
    // param=érték alak query stringben (?, & vagy string-elej után)
    out = out.replace(
      new RegExp(`([?&]|^)(${param})=[^&#]*`, 'gi'),
      `$1$2=${REDACTED}`,
    );
  }
  return out;
}

/**
 * Breadcrumb-mező szűrése — SZIGORÚBB, mint a saját kérésünké.
 *
 * ⚠️ 2026-08-09 (adatáramlási audit): a korábbi szűrés paraméter-NEVEK
 * listájára épült. Ez rossz minta egy biztonsági szűrőnél: pontosan azt nem
 * fogja meg, amire nem gondoltunk. Élesben ez a SeeMe SMS-gateway hívásán
 * bukott meg — az GET-es, tehát az ÉLES API-kulcs, a címzett telefonszáma és
 * a teljes SMS-szöveg (benne a 6 jegyű átvételi kóddal és a szállító
 * nevével/telefonjával) a query stringbe kerül, és az SMS-hiba riasztásával
 * együtt kiment volna a Sentrybe.
 *
 * A kimenő hívásaink MINDEGYIKE titkot vagy személyes adatot visz a query
 * stringben (SeeMe: kulcs+üzenet, Nominatim: a begépelt cím, VIES: adószám),
 * a breadcrumb hibakeresési értéke pedig a „melyik szolgáltatót hívtuk"
 * információ — ahhoz a query nem kell. Ezért itt a query stringet EGÉSZBEN
 * eldobjuk, nem paraméterenként válogatunk.
 */
function scrubBreadcrumbValue(value) {
  if (typeof value !== 'string' || !value) return value;
  const out = value.replace(SENSITIVE_PATH_RE, `$1${REDACTED}`);
  const q = out.indexOf('?');
  if (q === 0) return REDACTED;          // önálló query string (http.query)
  if (q > 0) return `${out.slice(0, q)}?${REDACTED}`; // teljes URL
  // ⚠️ '?' NÉLKÜLI query string is létezik: a Sentry `requestDataIntegration`
  // normalizált alakban (pl. „token=…&q=…") teszi az `url.query`-be. A '?'-re
  // épülő vágás ezt változatlanul átengedte volna — ma nem elérhető ág, de egy
  // SDK-frissítés vagy a span-streaming bekapcsolása élesíti.
  if (/^[\w.%+-]+=/.test(out) && !out.includes('://') && !out.startsWith('/')) return REDACTED;
  return out;
}

/**
 * Rekurzív bejárás: az esemény MINDEN string-értékét megszűri, tartalom
 * alapján. Ciklus- és mélység-védett, sosem dob.
 *
 * A `kihagy` halmaz azokat a részfákat védi, amiket máshol, FINOMABBAN
 * kezelünk (az `event.request`-en paraméter-szintű szűrés fut, hogy a
 * hibakereséshez hasznos `?status=bidding` megmaradjon).
 */
function melyszures(csomopont, kihagy = new Set(), melyseg = 0, latott = new WeakSet()) {
  if (melyseg > 12 || csomopont == null || typeof csomopont !== 'object') return;
  if (latott.has(csomopont)) return;
  latott.add(csomopont);

  for (const kulcs of Object.keys(csomopont)) {
    if (melyseg === 0 && kihagy.has(kulcs)) continue;
    const ertek = csomopont[kulcs];
    if (typeof ertek === 'string') {
      const urlSzeru = URL_LIKE_KEY_RE.test(kulcs) || urlSzeruErtek(ertek);
      csomopont[kulcs] = piiSzures(urlSzeru ? scrubBreadcrumbValue(ertek) : ertek);
    } else if (ertek && typeof ertek === 'object') {
      melyszures(ertek, kihagy, melyseg + 1, latott);
    }
  }
}

/**
 * Sentry beforeSend-kompatibilis esemény-szűrő. Mutálja és visszaadja az
 * eseményt (a Sentry-nek ez így megfelel).
 */
function scrubSentryEvent(event) {
  try {
    if (event && event.request) {
      const req = event.request;
      // 1) A kérés törzse SOSEM megy ki (cím/telefon/adószám/chat lehet benne)
      delete req.data;
      // 2) Auth-fejlécek
      if (req.headers) {
        delete req.headers.authorization;
        delete req.headers.Authorization;
        delete req.headers.cookie;
        delete req.headers.Cookie;
      }
      // 3) Tokenek az URL-ben / query stringben
      // ⚠️ A `request` KIMARAD a mélybejárásból (fent, a `kihagy` halmazban),
      // ezért a PII-szűrést ITT kell rátenni — enélkül a kérés-URL-be írt
      // e-mail/telefon átment (a közös korpusz ezt azonnal elkapta).
      req.url = piiSzures(scrubUrlLike(req.url));
      req.query_string = piiSzures(scrubUrlLike(req.query_string));
      // 4) Sütik külön mezőben is érkezhetnek
      delete req.cookies;
    }
    // ⚠️ AZ EGÉSZ ESEMÉNYT BEJÁRJUK (2026-08-11) — nem helyeket sorolunk fel.
    //
    // Ez a harmadik nekifutás ugyanarra a hibára, és a tanulság mostanra
    // egyértelmű. Először MEZŐNEVEKET soroltunk fel (url/to/from) → kimaradt a
    // `http.query`. Aztán BORÍTÉKOKAT (beforeSend/Span/Transaction) → kimaradt,
    // hogy EGY borítékon BELÜL is több másolat van ugyanabból az URL-ből:
    // `request.url`, a gyerek-spanek `data`-ja, ÉS a gyökér-span attribútumai
    // a `contexts.trace.data`-ban (@sentry/core sentrySpan.js → contexts.trace,
    // benne `http.url` a TELJES query stringgel, `http.target` és a
    // `http.client_ip`). Kettőt védtünk, a harmadik szűretlenül ment ki —
    // 10%-os mintavétellel, benne az ÉLŐ jelszó-reset tokennel.
    //
    // Ezért a szűrés mostantól NEM tudja, hol keressen: rekurzívan végigmegy
    // az esemény MINDEN string-értékén, és a tartalom alapján dönt. Egy
    // jövőbeli SDK-verzió új helye így automatikusan a hatálya alá kerül.
    // A `request` a PARAMÉTER-szintű szűrést kapta fent (hogy a hibakereséshez
    // hasznos `?status=bidding` megmaradjon) — ezért a mélybejárás URL-ágából
    // kimarad. A PII-ALAKOKAT viszont ott is ki kell takarni, ezért kap egy
    // saját, csak-PII menetet.
    melyszures(event, new Set(['request']));
    if (event && event.request && typeof event.request === 'object') {
      for (const kulcs of Object.keys(event.request)) {
        if (typeof event.request[kulcs] === 'string') {
          event.request[kulcs] = piiSzures(event.request[kulcs]);
        }
      }
    }
    return event;
  } catch {
    return event;
  }
}

/**
 * Egy SPAN szűrése (beforeSendSpan).
 *
 * ⚠️ 2026-08-10 — EZ AZ OSZTÁLY, amit reggel NEM zártam le. A `beforeSend`
 * KIZÁRÓLAG hiba-eseményen fut (@sentry/core client.js: `isErrorEvent(...)
 * && beforeSend`). A teljesítmény-események (tracesSampleRate) MÁSIK
 * borítékban mennek, és ugyanazt az adatot viszik: a kimenő fetch spanjének
 * attribútumai közt ott a teljes URL query-vel (`url.full`) ÉS a nyers query
 * string (`url.query`) — vagyis az ÉLES SeeMe API-kulcs, a 6 jegyű átvételi
 * kód és a telefonszámok. Reggel a breadcrumb-mezőket kerestem; azt kellett
 * volna kérdeznem, HÁNYFÉLE BORÍTÉKBAN hagyhatja el ugyanaz az adat a
 * rendszert.
 */
function scrubSentrySpan(span) {
  try {
    if (!span || typeof span !== 'object') return span;
    // A leírásban is ott lehet a teljes URL (pl. „GET https://…?key=…").
    if (typeof span.description === 'string') {
      span.description = scrubBreadcrumbValue(span.description);
    }
    if (span.data && typeof span.data === 'object') {
      for (const kulcs of Object.keys(span.data)) {
        const ertek = span.data[kulcs];
        if (typeof ertek === 'string' && (URL_LIKE_KEY_RE.test(kulcs) || urlSzeruErtek(ertek))) {
          span.data[kulcs] = scrubBreadcrumbValue(ertek);
        }
      }
    }
    return span;
  } catch {
    return span;
  }
}

/**
 * Egy TRANZAKCIÓ-esemény szűrése (beforeSendTransaction).
 * A kérés-adatokat ugyanúgy kezeljük, mint hibánál, és minden beágyazott
 * spanre lefuttatjuk a span-szűrőt.
 */
function scrubSentryTransaction(event) {
  try {
    scrubSentryEvent(event);
    if (event && Array.isArray(event.spans)) {
      for (const span of event.spans) scrubSentrySpan(span);
    }
    // A tranzakció NEVE is lehet URL-jellegű (böngészőben az útvonal).
    if (event && typeof event.transaction === 'string') {
      event.transaction = scrubBreadcrumbValue(event.transaction);
    }
    return event;
  } catch {
    return event;
  }
}

module.exports = {
  scrubSentryEvent, scrubSentrySpan, scrubSentryTransaction,
  scrubUrlLike, scrubBreadcrumbValue, urlSzeruErtek, piiSzures, melyszures, URL_LIKE_KEY_RE, REDACTED,
};
