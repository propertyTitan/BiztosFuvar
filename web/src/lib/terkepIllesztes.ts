// =====================================================================
//  Térkép-illesztés az útvonalra (2026-10-08, UX-átvizsgálás A17)
//
//  A térképek 7-es nagyítással (fél Közép-Európa) indultak, a ráközelítés
//  (`fitBounds`) pedig egy olyan effectben futott, ahol a térkép-példány
//  még nem létezett (`mapRef` csak az `onLoad`-ban kap értéket) — így az
//  első betöltéskor SOSEM érvényesült. Egy 6,5 km-es fuvar két jelölője
//  egymásra került. Ezt a segédet az `onLoad` ÉS a pontok változása is
//  hívja; rövid útnál legfeljebb 14-es nagyításig közelít (különben két
//  szomszédos utca épület-szintig nagyítana).
// =====================================================================

// A margó 24 px (fix1-review): 48 px mellett a 280 px magas feladói
// térképen 184 px maradt a pontoknak, így egy 100–200 km-es, észak–déli
// útvonal (Bp–Pécs ≈ 1,4 szélességi fok ≈ 190 px 7-es nagyításon) csak
// 6-os nagyítással fért be — fél Közép-Európa látszott. A jelölők 14 px
// sugarú körök (+2 px keret), a 24 px margó elég, hogy ne vágódjanak le.
export const ILLESZTES_MARGO_PX = 24;
export const ILLESZTES_MAX_ZOOM = 14;

type Pont = { lat: number; lng: number };

/** Érvényes, véges koordináták (a 0,0 is az — csak a NaN/null nem). */
export function ervenyesPontok(pontok: Array<Partial<Pont> | null | undefined>): Pont[] {
  return pontok.filter((p): p is Pont => (
    !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  ));
}

/**
 * A térképet a pontokra illeszti. Egyetlen pontnál középre tesz és a
 * maximális nagyítást használja. Nincs térkép / nincs Google API / nincs
 * pont → nem csinál semmit (false).
 */
export function illesztesPontokra(
  map: google.maps.Map | null | undefined,
  pontok: Array<Partial<Pont> | null | undefined>,
  { margo = ILLESZTES_MARGO_PX, maxZoom = ILLESZTES_MAX_ZOOM }: { margo?: number; maxZoom?: number } = {},
): boolean {
  const jo = ervenyesPontok(pontok);
  if (!map || jo.length === 0 || typeof google === 'undefined' || !google.maps) return false;
  if (jo.length === 1) {
    map.setCenter(jo[0]);
    map.setZoom(maxZoom);
    return true;
  }
  const bounds = new google.maps.LatLngBounds();
  jo.forEach((p) => bounds.extend(p));
  map.fitBounds(bounds, margo);
  // A fitBounds aszinkron állítja a nagyítást — az első „idle" után vágjuk.
  google.maps.event.addListenerOnce(map, 'idle', () => {
    const z = map.getZoom();
    if (typeof z === 'number' && z > maxZoom) map.setZoom(maxZoom);
  });
  return true;
}
