// Zöld / üzemanyag becslések.
//
// A GoFuvar modell eleve zöldebb egy dedikált futárnál: a sofőr ÚGYIS megy
// A→B, a csomag egy MEGLÉVŐ úton utazik → nincs plusz jármű, nincs plusz
// károsanyag (ezt erősíti a visszafuvar-matching is). Ez a helper ebből
// csinál kézzelfogható, TÁJÉKOZTATÓ nagyságrendet — nem ígéret.
//
// Minden konstans egy helyen, konzervatívan hangolva. Ha az árak/normák
// változnak, csak itt kell nyúlni hozzá.

/** Átlagos személyautó fogyasztása (l/100km). */
export const FUEL_L_PER_100KM = 7;
/** Üzemanyag becsült ára (Ft/liter), 2026-os magyar nagyságrend. */
export const FUEL_HUF_PER_L = 650;
/** Egy elkerült dedikált futár-kisteher kibocsátása (g CO₂/km).
 *  A csomag meglévő úton utazik, tehát ennyi kibocsátás marad el. */
export const VAN_CO2_G_PER_KM = 250;

/** Az út becsült üzemanyagköltsége (Ft). */
export function fuelCostHuf(distanceKm: number): number {
  if (!distanceKm || distanceKm < 0) return 0;
  return Math.round(distanceKm * (FUEL_L_PER_100KM / 100) * FUEL_HUF_PER_L);
}

/** Az úthoz becsült üzemanyag (liter). */
export function fuelLiters(distanceKm: number): number {
  if (!distanceKm || distanceKm < 0) return 0;
  return +(distanceKm * (FUEL_L_PER_100KM / 100)).toFixed(1);
}

/** A meglévő úton szállítással megspórolt (elkerült) CO₂ (kg). */
export function co2SavedKg(distanceKm: number): number {
  if (!distanceKm || distanceKm < 0) return 0;
  return Math.round(distanceKm * (VAN_CO2_G_PER_KM / 1000));
}

export type GreenStats = {
  fuelCostHuf: number;
  fuelLiters: number;
  co2SavedKg: number;
  /** Ha van fuvardíj: hányszorosan fedezi a díj az út üzemanyagát. */
  coversFuel: number | null;
};

/**
 * Egy fuvar zöld/üzemanyag mutatói a távolságból (és opcionálisan a
 * fuvardíjból).
 */
export function greenStats(distanceKm: number, priceHuf?: number | null): GreenStats {
  const fuel = fuelCostHuf(distanceKm);
  return {
    fuelCostHuf: fuel,
    fuelLiters: fuelLiters(distanceKm),
    co2SavedKg: co2SavedKg(distanceKm),
    coversFuel: priceHuf && fuel > 0 ? +(priceHuf / fuel).toFixed(1) : null,
  };
}
