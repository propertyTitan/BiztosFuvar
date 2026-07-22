// Sentry-esemény PII-szűrés (a backend utils/sentryScrub.js web-párja).
//
// A Sentry a hibaesemény mellé teszi a kérés/oldal kontextusát — nálunk
// ezekben személyes adat utazhat:
//   - request body (form-payload: cím, telefonszám, adószám, chat-üzenet)
//   - az oldal URL-je: a /jelszo-reset?token= és /email-megerositese?token=
//     oldalakon ÉLŐ, egyszer használatos auth-token áll a query-ben
//   - breadcrumb-ök (navigáció/fetch URL-jei) — ugyanezek a tokenek
//   - Authorization/cookie fejlécek
// Szabály: body eldobva, token-paraméterek kitakarva, auth-fejlécek törölve.
// A függvény sosem dob — hiba esetén az eredeti eseményt adja vissza (egy
// elrontott szűrés miatt hibajelentést veszíteni rosszabb).

const REDACTED = '[SZURVE]';

const SENSITIVE_PARAMS = ['token', 'access_token', 'refresh_token', 'api_key', 'apikey', 'secret', 'password', 'code'];

// Útvonal-szegmens, ami után titok áll (publikus tracking-token)
const SENSITIVE_PATH_RE = /(\/tracking\/|\/nyomon-kovetes\/)[^/?#]+/gi;

/** Query string / teljes URL token-paramétereinek kitakarása. */
export function scrubUrlLike<T>(value: T): T {
  if (typeof value !== 'string' || !value) return value;
  let out = (value as string).replace(SENSITIVE_PATH_RE, `$1${REDACTED}`);
  for (const param of SENSITIVE_PARAMS) {
    out = out.replace(
      new RegExp(`([?&]|^)(${param})=[^&#]*`, 'gi'),
      `$1$2=${REDACTED}`,
    );
  }
  return out as unknown as T;
}

/** Sentry beforeSend-kompatibilis esemény-szűrő (mutál + visszaad). */
export function scrubSentryEvent<E extends Record<string, any>>(event: E): E {
  try {
    const req = event?.request;
    if (req) {
      delete req.data;
      if (req.headers) {
        delete req.headers.authorization;
        delete req.headers.Authorization;
        delete req.headers.cookie;
        delete req.headers.Cookie;
      }
      req.url = scrubUrlLike(req.url);
      req.query_string = scrubUrlLike(req.query_string);
      delete req.cookies;
    }
    if (Array.isArray(event?.breadcrumbs)) {
      for (const crumb of event.breadcrumbs) {
        if (crumb?.data) {
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
