// =====================================================================
//  Mértékegységes számok magyar formában (2026-10-08, UX A17 2. lépés)
//
//  A pg NUMERIC oszlopai (weight_kg, distance_km) STRINGKÉNT jönnek
//  („65.00”, „164.07”), és a felület nyersen írta ki őket — egy kártyán
//  belül állt „1,61 m³” (vessző) mellett „65.00 kg” és „164.07 km” (pont).
//  Ez a segéd egységesen a magyar tizedesvesszőt és a felesleges nullák
//  elhagyását adja; a szám és az egység közt nem törhető szóköz áll.
// =====================================================================

/** „65 kg”, „164,1 km”, „1,61 m³” — érvénytelen/hiányzó értékre üres szöveg. */
export function mertek(
  ertek: number | string | null | undefined,
  egyseg: string,
  tizedes = 1,
): string {
  if (ertek == null || ertek === '') return '';
  const n = Number(ertek);
  if (!Number.isFinite(n)) return '';
  return `${n.toLocaleString('hu-HU', { maximumFractionDigits: tizedes })} ${egyseg}`;
}
