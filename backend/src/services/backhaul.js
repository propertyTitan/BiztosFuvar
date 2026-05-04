// =====================================================================
//  Visszafuvar-matching (backhaul) — a logisztika "szent grálja".
//
//  Ha egy sofőr már elvállalt egy A → B fuvart (vagy van egy útvonala
//  A-ból B-be), a rendszer automatikusan kiajánlja neki az olyan
//  feladott fuvarokat, amelyek:
//     - pickup-ja a B közelében van (a sofőr ott lesz úgyis)
//     - dropoff-ja az A közelében van (úgyis hazamegy)
//
//  Miért jó ez?
//     - Sofőrnek: az üres visszaút kiestő bevétel. Egy visszafuvar
//       duplázza a jövedelmét ugyanarra a kilométerre.
//     - Feladónak: olcsóbb árat kaphat (a sofőrnek az út eleve fix
//       költség, bármi plus bevétel).
//     - Platformnak: több befejezett fuvar = több 10% jutalék.
//
//  Nincs szükség új DB mezőre — csak koordináta-alapú query és
//  Haversine távolság-szűrő a meglévő `jobs` táblán.
// =====================================================================

const db = require('../db');
const { distanceMeters } = require('../utils/geo');

// Visszafuvar keresésnél mennyire lehet "eltérő" a pont a sofőr
// útvonalának végpontjaitól. 30 km jól kiszámolt default:
//   - nagyvárosi környezetben (Budapest-agglomeráció) lefedi a környékbeli
//     kerületeket,
//   - vidéken kisebb városok között nincs túl sok "majdnem útba eső"
//     false positive,
//   - a sofőr megteheti a kitérőt 15-20 percnyi plusz vezetéssel.
const DEFAULT_RADIUS_KM = 30;

// Maximum hány visszafuvar ajánlatot listázunk egy sofőrnek egy lekérésre.
const MAX_SUGGESTIONS = 50;

/**
 * Visszafuvar kandidátusok keresése egy adott (A, B) útvonalhoz.
 *
 * @param {object}  params
 * @param {number}  params.originLat    A indulási pont latitude (az EREDETI fuvar pickup)
 * @param {number}  params.originLng    A indulási pont longitude
 * @param {number}  params.destLat      B célpont latitude (az EREDETI fuvar dropoff)
 * @param {number}  params.destLng      B célpont longitude
 * @param {string}  params.carrierId    A sofőr user id (hogy kiszűrjük a saját fuvarait)
 * @param {Date}    [params.earliestPickupAt] Legkorábbi pickup időpont (alap: most)
 * @param {number}  [params.radiusKm]   Keresési sugár km-ben (alap: 30)
 * @param {number}  [params.limit]      Max találat (alap: 50)
 * @returns {Promise<Array<Job & {backhaul_distance_km:number,backhaul_score:number}>>}
 */
async function findBackhaulCandidates({
  originLat, originLng, destLat, destLng,
  carrierId, earliestPickupAt,
  radiusKm = DEFAULT_RADIUS_KM,
  limit = MAX_SUGGESTIONS,
}) {
  if (
    !Number.isFinite(originLat) || !Number.isFinite(originLng) ||
    !Number.isFinite(destLat)   || !Number.isFinite(destLng)
  ) {
    return [];
  }

  // Bounding box pre-filter: a PostgreSQL `lat/lng BETWEEN` index-friendly,
  // ~30 km-re egy fok kb. 1/111 rész. Innen durván szűrünk, utána
  // Haversine-nal pontosan válogatunk JS-ben.
  //
  // Fontos: a Föld görbülete miatt longitude 1 fok != 111 km, hanem
  // 111 * cos(lat) km. Budapest szintjén ~73 km/fok. Ezért lat-ot és lng-t
  // külön-külön becsüljük.
  const latDeg = radiusKm / 111;
  const lngDegAtOrigin = radiusKm / (111 * Math.max(0.1, Math.cos((originLat * Math.PI) / 180)));
  const lngDegAtDest   = radiusKm / (111 * Math.max(0.1, Math.cos((destLat   * Math.PI) / 180)));

  // FONTOS a feltétel-sorrend:
  //   - pickup B közelében (hiszen a sofőr B-ben van az első fuvar után)
  //   - dropoff A közelében (így zár a kör, vissza a kiindulás közelébe)
  const { rows } = await db.query(
    `SELECT j.*,
            s.full_name AS shipper_name,
            s.rating_avg AS shipper_rating_avg,
            s.rating_count AS shipper_rating_count
       FROM jobs j
       JOIN users s ON s.id = j.shipper_id
      WHERE j.status = 'bidding'
        AND j.shipper_id <> $1
        AND j.pickup_lat  BETWEEN $2 AND $3
        AND j.pickup_lng  BETWEEN $4 AND $5
        AND j.dropoff_lat BETWEEN $6 AND $7
        AND j.dropoff_lng BETWEEN $8 AND $9
        AND (j.pickup_window_end IS NULL OR j.pickup_window_end >= COALESCE($10::timestamptz, NOW()))
      ORDER BY j.created_at DESC
      LIMIT $11`,
    [
      carrierId,
      destLat - latDeg,   destLat + latDeg,
      destLng - lngDegAtDest, destLng + lngDegAtDest,
      originLat - latDeg, originLat + latDeg,
      originLng - lngDegAtOrigin, originLng + lngDegAtOrigin,
      earliestPickupAt || null,
      limit,
    ],
  );

  // Pontos Haversine utószűrés + score számítás.
  // A score a két távolság átlagából indul (minél kisebb, annál jobb),
  // normalizálva a keresési sugárral (0 = tökéletesen egybeesik, 1 = a
  // sugár határán). Ebből számolunk egy "0-100 illeszkedés" pontszámot,
  // amit a sofőr UI-on megmutatunk.
  const candidates = [];
  for (const j of rows) {
    const pickupFromB_m = distanceMeters(destLat,   destLng,   j.pickup_lat,  j.pickup_lng);
    const dropFromA_m   = distanceMeters(originLat, originLng, j.dropoff_lat, j.dropoff_lng);
    const pickupFromB_km = pickupFromB_m / 1000;
    const dropFromA_km   = dropFromA_m   / 1000;
    if (pickupFromB_km > radiusKm || dropFromA_km > radiusKm) continue;

    const avgDeviationKm = (pickupFromB_km + dropFromA_km) / 2;
    // 0-100 skálán: minél közelebb mindkét pont, annál magasabb pontszám.
    const score = Math.round(Math.max(0, 100 * (1 - avgDeviationKm / radiusKm)));

    candidates.push({
      ...j,
      backhaul_pickup_from_dest_km: +pickupFromB_km.toFixed(2),
      backhaul_drop_from_origin_km: +dropFromA_km.toFixed(2),
      backhaul_score: score,
    });
  }

  // Score szerinti csökkenő sorrend — a legjobb visszafuvarok elöl.
  candidates.sort((a, b) => b.backhaul_score - a.backhaul_score);
  return candidates;
}

/**
 * A sofőr éppen aktív (accepted/in_progress) fuvaraira épülve keres
 * visszafuvar-ajánlatokat. Ha nincs aktív fuvar, üres listát ad.
 * A válaszban minden "trip" a saját kandidátusaival jön vissza.
 *
 * Route-alapú (publikált carrier_routes) kiegészítés egyelőre NEM része
 * ennek a függvénynek — a licites fuvar a gyakoribb eset, azzal kezdünk.
 *
 * @param {string} carrierId
 */
async function suggestionsForCarrier(carrierId) {
  // Aktív A→B fuvarok (még nem kézbesítve, már elfogadva)
  const { rows: trips } = await db.query(
    `SELECT id AS trip_id,
            title AS trip_title,
            pickup_lat,  pickup_lng,  pickup_address,
            dropoff_lat, dropoff_lng, dropoff_address,
            pickup_window_end
       FROM jobs
      WHERE carrier_id = $1
        AND status IN ('accepted', 'in_progress')
      ORDER BY created_at DESC
      LIMIT 10`,
    [carrierId],
  );

  const out = [];
  for (const t of trips) {
    const cands = await findBackhaulCandidates({
      originLat: t.pickup_lat,
      originLng: t.pickup_lng,
      destLat:   t.dropoff_lat,
      destLng:   t.dropoff_lng,
      carrierId,
      earliestPickupAt: t.pickup_window_end || null,
    });
    if (cands.length > 0) {
      out.push({
        trip_id: t.trip_id,
        trip_title: t.trip_title,
        trip_pickup_address: t.pickup_address,
        trip_dropoff_address: t.dropoff_address,
        candidates: cands,
      });
    }
  }
  return out;
}

module.exports = {
  findBackhaulCandidates,
  suggestionsForCarrier,
  DEFAULT_RADIUS_KM,
};
