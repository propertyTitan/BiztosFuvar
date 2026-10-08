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
  // `useGrouping: 'always'`: a hu-HU a 4 jegyű számot alapból nem tagolja
  // („1250 km"), a díjak viszont tagoltak (connectionFee.ft) — egy alak.
  return `${n.toLocaleString('hu-HU', { maximumFractionDigits: tizedes, useGrouping: 'always' })} ${egyseg}`;
}

/**
 * Értékelés-átlag egy tizedessel, magyar tizedesvesszővel: „4,7" (a pg
 * NUMERIC „4.70" stringként jön, a felület eddig „4.7"-et és „4.70"-et is
 * írt — fix2-review, A17 maradéka). Érvénytelen/hiányzó értékre üres szöveg.
 */
export function ertekeles(atlag: number | string | null | undefined): string {
  if (atlag == null || atlag === '') return '';
  const n = Number(atlag);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('hu-HU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
