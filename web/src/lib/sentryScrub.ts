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

// A breadcrumb-adatok azon kulcsai, amelyekben URL vagy query string állhat.
const URL_LIKE_KEY_RE = /(^|\.)(url|to|from|query|fragment|href|link)$/i;

/**
 * Breadcrumb-mező szűrése — szigorúbb, mint a saját kérésünké: a query
 * stringet EGÉSZBEN eldobjuk, nem paraméterenként válogatunk.
 */
export function scrubBreadcrumbValue(value: string): string {
  if (typeof value !== 'string' || !value) return value;
  const out = value.replace(SENSITIVE_PATH_RE, `$1${REDACTED}`);
  const q = out.indexOf('?');
  if (q === 0) return REDACTED;
  if (q > 0) return `${out.slice(0, q)}?${REDACTED}`;
  return out;
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
    // Breadcrumb-ok: nem mezőnevet sorolunk fel (a backend-oldali szűrő ezen
    // bukott el 2026-08-09-én — a `http.query` mezőt nem érte el), hanem
    // MINDEN URL-jellegű kulcsot végigveszünk, és a query stringet EGÉSZBEN
    // eldobjuk. A hibakereséshez a hívott végpont neve elég; a paraméterek
    // (keresőszöveg, cím, token) nem tartoznak a Sentryre.
    if (Array.isArray(event?.breadcrumbs)) {
      for (const crumb of event.breadcrumbs) {
        if (crumb?.data && typeof crumb.data === 'object') {
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
