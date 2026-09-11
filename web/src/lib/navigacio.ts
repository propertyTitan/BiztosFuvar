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
