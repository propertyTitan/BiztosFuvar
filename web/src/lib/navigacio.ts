// Biztonságos „vissza ide" cél a belépés után (2026-09-11, teljes audit B2).
//
// A `?next=` paraméter felhasználói input: csak BELSŐ, relatív útvonalat
// fogadunk el — a `//gonosz.hu`, a `https://…`, a `javascript:` és a
// backslash-trükkök nyílt átirányítás lennének (phishing a saját
// bejelentkezés-oldalunkról).
export function biztonsagosBelsoUt(ertek: string | null | undefined): string | null {
  if (!ertek) return null;
  const s = String(ertek).trim();
  if (!s.startsWith('/')) return null;
  if (s.startsWith('//') || s.startsWith('/\\')) return null;
  if (/[\x00-\x1f\x7f]/.test(s)) return null;
  if (s.length > 512) return null;
  return s;
}

/**
 * Teljes oldalas navigáció egy KÜLSŐ (vagy az API-n lévő) címre — pl. a CIB
 * egyszer használatos átirányító linkjére (CIB PR-3).
 *
 * Külön függvény, hogy a hívók tesztelhetők legyenek: a jsdom a
 * `window.location.assign`-t nem tudja végrehajtani, és felüldefiniálni sem
 * engedi — a tesztek ezt a modult mockolják.
 */
export function kulsoOldalraLep(url: string): void {
  window.location.assign(url);
}
