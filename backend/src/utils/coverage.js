// =====================================================================
//  Szolgáltatási terület (coverage zone) kezelés.
//
//  Induláskor: csak Budapest + Pest megye.
//  A koordináta-alapú bounding box egyszerű és gyors.
//  Később bővíthető: Szeged, Debrecen, stb.
//
//  Használat:
//    const { isInCoverageZone, ZONES } = require('./coverage');
//    if (!isInCoverageZone(lat, lng)) → "Hamarosan elérhető!"
// =====================================================================

const ZONES = [
  {
    id: 'hungary',
    name: 'Magyarország',
    active: true,
    // Egész Magyarország bounding box
    minLat: 45.73,
    maxLat: 48.59,
    minLng: 16.11,
    maxLng: 22.90,
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
