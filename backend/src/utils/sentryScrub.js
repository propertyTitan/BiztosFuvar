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
const SENSITIVE_PARAMS = ['token', 'access_token', 'refresh_token', 'api_key', 'apikey', 'secret', 'password', 'code'];

// Útvonal-szegmensek, amelyek után titok vagy személyes adat áll.
//   /tracking/<token>  — a publikus követő-link
//   /vat/<adószám>     — a VIES adószám-ellenőrzés az ÚTVONALBA teszi a
//                        számot (services/vat.js), nem query-paraméterbe
const SENSITIVE_PATH_RE = /(\/tracking\/|\/vat\/)[^/?#]+/gi;

// A breadcrumb-adatok azon kulcsai, amelyekben URL vagy query string állhat.
// A `http.query` a Sentry Node SDK saját mezője: a kimenő fetch NYERS query
// stringjét teszi bele (node-core/utils/outgoingFetchRequest.js) — ezt a
// korábbi, mezőnév-felsoroláson alapuló szűrés nem érte el.
const URL_LIKE_KEY_RE = /(^|\.)(url|to|from|query|fragment|href|link)$/i;

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
  return out;
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
      req.url = scrubUrlLike(req.url);
      req.query_string = scrubUrlLike(req.query_string);
      // 4) Sütik külön mezőben is érkezhetnek
      delete req.cookies;
    }
    // Breadcrumb-ok: a KIMENŐ hívások URL-jei és query stringjei.
    // Nem mezőnevet sorolunk fel (azon buktunk el), hanem MINDEN URL-jellegű
    // kulcsot végigveszünk — így az SDK bármelyik verziója által termelt
    // mező (ma: url, http.query, http.fragment) automatikusan a szűrő alá esik.
    if (event && Array.isArray(event.breadcrumbs)) {
      for (const crumb of event.breadcrumbs) {
        if (crumb && crumb.data && typeof crumb.data === 'object') {
          for (const kulcs of Object.keys(crumb.data)) {
            if (URL_LIKE_KEY_RE.test(kulcs) && typeof crumb.data[kulcs] === 'string') {
              crumb.data[kulcs] = scrubBreadcrumbValue(crumb.data[kulcs]);
            }
          }
        }
      }
    }
    return event;
  } catch {
    return event;
  }
}

module.exports = { scrubSentryEvent, scrubUrlLike, scrubBreadcrumbValue, REDACTED };
