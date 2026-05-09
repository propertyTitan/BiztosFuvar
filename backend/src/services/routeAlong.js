// =====================================================================
//  "Útba esik" matching — fuvarok keresése egy útvonal MENTÉN.
//
//  A sofőr megy A → B → C útvonalra. Keresünk olyan nyitott (bidding)
//  fuvarokat, amelyek:
//    - pickup-ja az útvonal BÁRMELYIK waypoint-ja közelében van,
//    - dropoff-ja egy KÉSŐBBI waypoint közelében van,
//    - tehát a csomag UGYANABBA az irányba halad mint a sofőr.
//
//  Pl. útvonal: Szeged → Kecskemét → Budapest
//    → passzol: Szeged közeli pickup → Budapest közeli dropoff
//    → passzol: Kecskemét közeli pickup → Budapest közeli dropoff
//    → NEM passzol: Budapest közeli pickup → Szeged közeli dropoff
//      (ez visszafelé lenne → azt a backhaul service kezeli)
//
//  A keresési sugár waypoint-onként 15 km — elég nagy, hogy a szomszédos
//  településeket is lefedje, de nem túl nagy, hogy értelmetlen kitérőt
//  kérjen a sofőrtől.
// =====================================================================

const db = require('../db');
const { distanceMeters } = require('../utils/geo');

const ALONG_RADIUS_KM = 15;

/**
 * Egy útvonal waypoint-jai mentén keres passzoló nyitott fuvarokat.
 *
 * @param {Array<{lat:number, lng:number, name?:string}>} waypoints
 * @param {string} carrierId — kizárjuk a saját feladásait
 * @param {number} [radiusKm=15]
 * @returns {Promise<Array<Job & {along_pickup_wp:number, along_dropoff_wp:number, along_detour_km:number}>>}
 */
async function findJobsAlongRoute(waypoints, carrierId, radiusKm = ALONG_RADIUS_KM) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return [];

  // Bounding box: az egész útvonal mentén keresünk. A legkisebb és
  // legnagyobb lat/lng a waypoint-okból + sugár → nagy pre-filter box.
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const wp of waypoints) {
    if (wp.lat < minLat) minLat = wp.lat;
    if (wp.lat > maxLat) maxLat = wp.lat;
    if (wp.lng < minLng) minLng = wp.lng;
    if (wp.lng > maxLng) maxLng = wp.lng;
  }
  const latDeg = radiusKm / 111;
  const avgLat = (minLat + maxLat) / 2;
  const lngDeg = radiusKm / (111 * Math.max(0.1, Math.cos((avgLat * Math.PI) / 180)));

  // Pre-filter: minden bidding fuvar, aminek pickup VAGY dropoff az
  // útvonal bounding box-ában van (tágított sugárral). A pontos waypoint-
  // közeli szűrést JS-ben csináljuk.
  const { rows } = await db.query(
    `SELECT j.*,
            u.full_name AS shipper_name
       FROM jobs j
       JOIN users u ON u.id = j.shipper_id
      WHERE j.status = 'bidding'
        AND j.shipper_id <> $1
        AND j.pickup_lat  BETWEEN $2 AND $3
        AND j.pickup_lng  BETWEEN $4 AND $5
      ORDER BY j.created_at DESC
      LIMIT 500`,
    [
      carrierId,
      minLat - latDeg, maxLat + latDeg,
      minLng - lngDeg, maxLng + lngDeg,
    ],
  );

  // Pontos waypoint-közeli matching JS-ben.
  // Szabály: pickup közel van a wp[i]-hez, dropoff közel van a wp[j]-hez,
  // ahol i < j (tehát a csomag az útvonal irányába halad).
  const results = [];
  for (const job of rows) {
    let bestPickupWp = -1;
    let bestPickupDist = Infinity;
    let bestDropoffWp = -1;
    let bestDropoffDist = Infinity;

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const pickupDist = distanceMeters(wp.lat, wp.lng, job.pickup_lat, job.pickup_lng) / 1000;
      if (pickupDist <= radiusKm && pickupDist < bestPickupDist) {
        bestPickupDist = pickupDist;
        bestPickupWp = i;
      }
    }

    if (bestPickupWp < 0) continue;

    // Dropoff: csak a pickup waypoint UTÁNI waypoint-oknál keresünk.
    for (let j = bestPickupWp + 1; j < waypoints.length; j++) {
      const wp = waypoints[j];
      const dropDist = distanceMeters(wp.lat, wp.lng, job.dropoff_lat, job.dropoff_lng) / 1000;
      if (dropDist <= radiusKm && dropDist < bestDropoffDist) {
        bestDropoffDist = dropDist;
        bestDropoffWp = j;
      }
    }

    if (bestDropoffWp < 0) continue;

    // "Kitérő km": pickup eltérés + dropoff eltérés a waypoint-tól.
    // Minél kisebb, annál kevesebb extra út a sofőrnek.
    const detourKm = +(bestPickupDist + bestDropoffDist).toFixed(2);

    results.push({
      ...job,
      along_pickup_wp: bestPickupWp,
      along_pickup_wp_name: waypoints[bestPickupWp].name || `#${bestPickupWp + 1}`,
      along_pickup_detour_km: +bestPickupDist.toFixed(2),
      along_dropoff_wp: bestDropoffWp,
      along_dropoff_wp_name: waypoints[bestDropoffWp].name || `#${bestDropoffWp + 1}`,
      along_dropoff_detour_km: +bestDropoffDist.toFixed(2),
      along_detour_km: detourKm,
    });
  }

  // Legkisebb kitérő elöl.
  results.sort((a, b) => a.along_detour_km - b.along_detour_km);
  return results;
}

module.exports = { findJobsAlongRoute, ALONG_RADIUS_KM };
