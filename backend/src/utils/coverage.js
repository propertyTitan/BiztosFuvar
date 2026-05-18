// =====================================================================
//  Szolgáltatási terület (coverage zone) kezelés.
//
//  Európa-szintű lefedettség: Magyarország fő piac + szomszédos országok
//  + EU. A koordináta-alapú bounding box egyszerű és gyors.
//
//  A bbox tágan: Portugália (-10 lng) → Bulgária / EU-keleti határ
//  (32 lng), Mediterrán partok (34 lat) → Skandinávia déli része
//  (71 lat). EU + UK + Norvégia + Svájc + Balkán mind benne.
//
//  Megjegyzés: a fő piacunk továbbra is Magyarország, de magasabb áron
//  vállalt nemzetközi fuvarokat (pl. Pest → Bécs / Pozsony / Bukarest)
//  is engedjük a platformon.
//
//  Használat:
//    const { isInCoverageZone, ZONES } = require('./coverage');
//    if (!isInCoverageZone(lat, lng)) → "Hamarosan elérhető!"
// =====================================================================

const ZONES = [
  {
    id: 'europe',
    name: 'Európa',
    active: true,
    minLat: 34.0,
    maxLat: 71.0,
    minLng: -10.0,
    maxLng: 32.0,
  },
];

/**
 * Ellenőrzi, hogy a koordináta aktív szolgáltatási területen belül van-e.
 * Elég ha a pickup VAGY a dropoff benne van — így a Budapest → vidék
 * irányú fuvarok is működnek.
 */
function isInCoverageZone(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return ZONES.some(
    (z) => z.active && lat >= z.minLat && lat <= z.maxLat && lng >= z.minLng && lng <= z.maxLng,
  );
}

/**
 * Visszaadja a legközelebbi (még nem aktív) zóna nevét, ha a koordináta
 * nincs aktív zónában. Ez jelenik meg a "Hamarosan elérhető" üzenetben.
 */
function nearestUpcomingZone(lat, lng) {
  let closest = null;
  let minDist = Infinity;
  for (const z of ZONES) {
    if (z.active) continue;
    const centerLat = (z.minLat + z.maxLat) / 2;
    const centerLng = (z.minLng + z.maxLng) / 2;
    const dist = Math.sqrt((lat - centerLat) ** 2 + (lng - centerLng) ** 2);
    if (dist < minDist) {
      minDist = dist;
      closest = z;
    }
  }
  return closest;
}

/**
 * Az összes aktív zóna listája (frontend megjelenítéshez).
 */
function getActiveZones() {
  return ZONES.filter((z) => z.active);
}

/**
 * Az összes zóna (aktív + hamarosan) — a térkép szürkítéshez.
 */
function getAllZones() {
  return ZONES;
}

module.exports = { isInCoverageZone, nearestUpcomingZone, getActiveZones, getAllZones, ZONES };
