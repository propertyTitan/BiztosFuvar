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
    id: 'budapest_pest',
    name: 'Budapest és Pest megye',
    active: true,
    // Pest megye bounding box (bőven lefedi Budapestet is)
    minLat: 47.05,
    maxLat: 47.95,
    minLng: 18.40,
    maxLng: 19.60,
  },
  // Később aktiválható zónák:
  {
    id: 'szeged',
    name: 'Szeged és környéke',
    active: false,
    minLat: 46.15,
    maxLat: 46.40,
    minLng: 19.95,
    maxLng: 20.30,
  },
  {
    id: 'debrecen',
    name: 'Debrecen és környéke',
    active: false,
    minLat: 47.40,
    maxLat: 47.65,
    minLng: 21.50,
    maxLng: 21.80,
  },
  {
    id: 'gyor',
    name: 'Győr és környéke',
    active: false,
    minLat: 47.60,
    maxLat: 47.75,
    minLng: 17.55,
    maxLng: 17.75,
  },
  {
    id: 'pecs',
    name: 'Pécs és környéke',
    active: false,
    minLat: 46.00,
    maxLat: 46.15,
    minLng: 18.15,
    maxLng: 18.35,
  },
  {
    id: 'miskolc',
    name: 'Miskolc és környéke',
    active: false,
    minLat: 48.05,
    maxLat: 48.15,
    minLng: 20.70,
    maxLng: 20.85,
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
