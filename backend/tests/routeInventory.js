// =====================================================================
//  Route-leltár — az Express router-stack bejárása
//
//  Miért futásidőben és nem kézzel karbantartott listából: egy kézi lista
//  ELAVUL. Így viszont az „adversarial-matrix" teszt MINDIG a valóságot
//  látja, és azonnal elhasal, ha valaki új végpontot tesz be anélkül, hogy
//  eldöntené, ki férhet hozzá.
//
//  Express 4: az `app._router.stack` rétegekből áll; egy réteg vagy egy
//  konkrét route (`layer.route`), vagy egy beágyazott router (`layer.handle
//  .stack`), amit egy útvonal-prefixre mountoltak. A prefixet a réteg
//  regexpjéből kell visszafejteni — az Express nem tárolja szövegesen.
// =====================================================================

/** Egy mount-réteg regexpjéből visszafejti az útvonal-prefixet ('' ha '/'). */
function prefixFromLayer(layer) {
  if (layer.path) return layer.path;
  const src = layer.regexp && layer.regexp.source;
  if (!src) return '';
  // Az Express a '/auth' mountból ilyet gyárt: ^\/auth\/?(?=\/|$)
  const m = src.match(/^\^\\\/((?:[\w\-.]|\\.)*)\\\/\?/);
  if (!m) return '';
  return '/' + m[1].replace(/\\(.)/g, '$1');
}

/**
 * Minden regisztrált végpont: `{ method, path }`, ahol a path a TELJES
 * (mount-prefixes) útvonal, pl. `POST /auth/login`.
 */
function listRoutes(app) {
  const out = [];

  function walk(stack, prefix) {
    for (const layer of stack) {
      if (layer.route) {
        const routePath = layer.route.path;
        // Egy route több metódusra is regisztrálható
        for (const method of Object.keys(layer.route.methods)) {
          if (!layer.route.methods[method]) continue;
          const full = (prefix + routePath).replace(/\/{2,}/g, '/');
          out.push({ method: method.toUpperCase(), path: full === '' ? '/' : full });
        }
      } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, prefix + prefixFromLayer(layer));
      }
    }
  }

  walk(app._router.stack, '');
  // Determinisztikus sorrend — a hibaüzenetek így olvashatók és diffelhetők
  out.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
  return out;
}

/** `METHOD /út` alakú kulcs — a manifesthez ezen egyeztetünk. */
function routeKey(r) {
  return `${r.method} ${r.path}`;
}

module.exports = { listRoutes, routeKey };
