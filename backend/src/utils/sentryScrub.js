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

// Útvonal-szegmensek, amelyek után titok áll (pl. /tracking/<token>).
const SENSITIVE_PATH_RE = /(\/tracking\/)[^/?#]+/gi;

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
    // Breadcrumb-URL-ek (navigáció/fetch) is hordozhatnak tokent
    if (event && Array.isArray(event.breadcrumbs)) {
      for (const crumb of event.breadcrumbs) {
        if (crumb && crumb.data) {
          crumb.data.url = scrubUrlLike(crumb.data.url);
          if (typeof crumb.data.to === 'string') crumb.data.to = scrubUrlLike(crumb.data.to);
          if (typeof crumb.data.from === 'string') crumb.data.from = scrubUrlLike(crumb.data.from);
        }
      }
    }
    return event;
  } catch {
    return event;
  }
}

module.exports = { scrubSentryEvent, scrubUrlLike, REDACTED };
