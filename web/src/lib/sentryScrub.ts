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

const SENSITIVE_PARAMS = ['token', 'access_token', 'refresh_token', 'api_key', 'apikey', 'secret', 'password', 'code', 'sig', 'exp',
  'search', 'q', 'lat', 'lng', 'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng', 'email', 'phone'];

// ⚠️ NEM CSAK URL-ALAKÚ ADAT SZIVÁROG (2026-08-11, adatáramlási audit).
// A backend 2026-08-11-én alak-független PII-szűrést kapott, a WEB NEM — és a
// saját őrünk ezt nem vehette észre, mert kizárólag a backend modult töltötte
// be. A böngészőben ez élő út volt: a Sentry `consoleIntegration`-je
// alapértelmezés szerint BE VAN kapcsolva, tehát minden `console.log` szövege
// breadcrumbként kimegy — nyers e-mail-címmel együtt.
// A szűrés ezért itt is ALAK-FÜGGETLEN: e-mailt és telefonszám-alakot bárhol
// kitakar, nem csak URL-jellegű stringben.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Telefonszám: vezető '+' VAGY elválasztók — így egy sima hosszú szám
// (időbélyeg, azonosító) nem esik áldozatul.
const TELEFON_RE = /(?:\+\d[\d\s\-/().]{7,18}\d|\b06[\s\-/]?\d{1,2}[\s\-/]?\d{3}[\s\-/]?\d{3,4}\b)/g;

/** E-mail és telefonszám kitakarása TETSZŐLEGES szövegből. */
export function piiSzures<T>(ertek: T): T {
  if (typeof ertek !== 'string' || !ertek) return ertek;
  return (ertek as string).replace(EMAIL_RE, REDACTED).replace(TELEFON_RE, REDACTED) as unknown as T;
}

// Útvonal-szegmens, ami után titok áll (publikus tracking-token)
// ⚠️ SZIMMETRIKUS a backend listájával (2026-08-11, közös korpusz).
const SENSITIVE_PATH_RE = /(\/tracking\/|\/nyomon-kovetes\/|\/vat\/|\/private-files\/)[^/?#]+/gi;

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
 * URL- vagy query-jellegű ÉRTÉK felismerése — TARTALOM alapján.
 * A kulcsnév-felsorolás azt hagyja ki, amire nem gondoltunk: az `url.full`
 * („full" végződés) épp a teljes URL-t hordozza, mégis kimaradt a mintából.
 */
function urlSzeruErtek(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  return value.includes('://') || /^[?&]/.test(value) || /[?&][\w.%+-]+=/.test(value);
}

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

/** Rekurzív bejárás: minden string-érték tartalom alapján szűrve. */
function melyszures(
  csomopont: any, kihagy = new Set<string>(), melyseg = 0, latott = new WeakSet<object>(),
): void {
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
      // ⚠️ A `request` kimarad a mélybejárásból, ezért a PII-szűrés ide kell.
      req.url = piiSzures(scrubUrlLike(req.url));
      req.query_string = piiSzures(scrubUrlLike(req.query_string));
      delete req.cookies;
    }
    // Breadcrumb-ok: nem mezőnevet sorolunk fel (a backend-oldali szűrő ezen
    // bukott el 2026-08-09-én — a `http.query` mezőt nem érte el), hanem
    // MINDEN URL-jellegű kulcsot végigveszünk, és a query stringet EGÉSZBEN
    // eldobjuk. A hibakereséshez a hívott végpont neve elég; a paraméterek
    // (keresőszöveg, cím, token) nem tartoznak a Sentryre.
    // ⚠️ AZ EGÉSZ ESEMÉNYT BEJÁRJUK — nem helyeket sorolunk fel. Egy borítékon
    // BELÜL is több másolat van ugyanabból az URL-ből (request.url, a
    // gyerek-spanek data-ja, és a gyökér-span attribútumai a
    // contexts.trace.data-ban). A böngészőben ez a jelszó-reset és az
    // e-mail-verify ÉLŐ tokenjét jelenti az oldal-URL-ből.
    melyszures(event, new Set(['request']));
    return event;
  } catch {
    return event;
  }
}

/**
 * Egy SPAN szűrése (beforeSendSpan).
 *
 * ⚠️ A `beforeSend` KIZÁRÓLAG hiba-eseményen fut. A teljesítmény-események
 * másik borítékban mennek; böngészőben a root span `url.full` attribútuma és
 * a tranzakció NEVE is tartalmazhatja az oldal URL-jét — benne a jelszó-reset
 * / e-mail-verify ÉLŐ tokenjével és a nyomon-követési tokennel.
 */
export function scrubSentrySpan<S extends Record<string, any>>(span: S): S {
  const sp = span as Record<string, any>;
  try {
    if (!span || typeof span !== 'object') return span;
    if (typeof sp.description === 'string') {
      sp.description = piiSzures(scrubBreadcrumbValue(sp.description));
    }
    if (sp.data && typeof sp.data === 'object') {
      for (const kulcs of Object.keys(sp.data)) {
        const ertek = sp.data[kulcs];
        if (typeof ertek === 'string') {
          const urlSzeru = URL_LIKE_KEY_RE.test(kulcs) || urlSzeruErtek(ertek);
          sp.data[kulcs] = piiSzures(urlSzeru ? scrubBreadcrumbValue(ertek) : ertek);
        }
      }
    }
    return span;
  } catch {
    return span;
  }
}

/** Egy TRANZAKCIÓ-esemény szűrése (beforeSendTransaction). */
export function scrubSentryTransaction<E extends Record<string, any>>(event: E): E {
  const ev = event as Record<string, any>;
  try {
    scrubSentryEvent(event);
    if (Array.isArray(event?.spans)) {
      for (const span of event.spans) scrubSentrySpan(span);
    }
    if (typeof ev?.transaction === 'string') {
      ev.transaction = scrubBreadcrumbValue(ev.transaction);
    }
    return event;
  } catch {
    return event;
  }
}
