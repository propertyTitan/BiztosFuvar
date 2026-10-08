// =====================================================================
//  Az új fuvar űrlap hibáinak navigációja (UX A14, 2026-10-08)
//
//  A kliensoldali validációs hiba eddig egy toastot is dobott, ami a ragadós
//  fejléc fölött, pont a hibás mezőt takarta (és duplán jött). Most: az ELSŐ
//  hibás mező fókuszt kap (az űrlap sorrendjében — a címek is, amiknek nincs
//  saját hibaüzenet-kulcsa, ezért eddig kimaradtak a fókuszból), a mező
//  alatt a magyarázat, a gomb fölött egy rövid összegzés — toast nélkül.
// =====================================================================

type Hibak = Record<string, string | null>;

/** Az űrlap sorrendje: [hiba-kulcs, a fókuszálandó elem id-je]. */
export const UJ_FUVAR_MEZO_SORREND: ReadonlyArray<readonly [string, string]> = [
  ['title', 'uj-cim'],
  ['pickup', 'fuvar-felvetel'],
  ['dropoff', 'fuvar-lerakodas'],
  ['length', 'uj-hossz'],
  ['width', 'uj-szelesseg'],
  ['height', 'uj-magassag'],
  ['weight', 'uj-suly'],
  ['price', 'uj-ar'],
  ['declared', 'fuvar-becsult-ertek'],
  ['recipientName', 'uj-cimzett-nev'],
  ['recipientPhone', 'uj-cimzett-tel'],
  ['recipientEmail', 'uj-cimzett-email'],
];

/**
 * A címmezők hibaüzenete — EGY forrás: a fókusz-sorrend, az összegzés és a
 * mező alatti FieldError is ezt használja (fix2-review: az üres címmező alatt
 * eddig nem állt szöveg, csak a gomb fölötti összegzés mondta meg, mi a baj).
 */
export const CIM_HIBA = {
  pickup: 'A felvétel helyét válaszd ki a legördülő listából, házszámmal együtt.',
  dropoff: 'A lerakodás helyét válaszd ki a legördülő listából, házszámmal együtt.',
} as const;

function osszesHiba(hibak: Hibak, felvetelOk: boolean, lerakodasOk: boolean): Hibak {
  return {
    ...hibak,
    pickup: felvetelOk ? null : CIM_HIBA.pickup,
    dropoff: lerakodasOk ? null : CIM_HIBA.dropoff,
  };
}

/** Az első hibás mező id-je az űrlap sorrendjében (vagy null). */
export function elsoHibasMezoId(hibak: Hibak, felvetelOk: boolean, lerakodasOk: boolean): string | null {
  const minden = osszesHiba(hibak, felvetelOk, lerakodasOk);
  const talalat = UJ_FUVAR_MEZO_SORREND.find(([kulcs]) => minden[kulcs]);
  return talalat ? talalat[1] : null;
}

/**
 * A gomb fölötti összegzés. Szándékosan NEM ismétli a mező alatti üzenetet
 * (az E2E a mező-üzenetet keresi az űrlapon belül — két egyforma szöveg
 * összezavarná), csak a darabszámot és a teendőt mondja.
 */
export function hibaOsszegzes(hibak: Hibak, felvetelOk: boolean, lerakodasOk: boolean): string | null {
  const db = Object.values(osszesHiba(hibak, felvetelOk, lerakodasOk)).filter(Boolean).length;
  if (db === 0) return null;
  return `Még ${db} mezőt kell kitölteni vagy javítani — a pirossal jelölt mezőknél olvasod, mi a teendő.`;
}
