// =====================================================================
//  Azonnali fuvar ("UberFuvar" mód) segédfüggvények.
//
//  A modell egyszerű: amikor a feladó egy azonnali fuvart ad fel,
//  PUSH értesítést küldünk minden olyan sofőrnek, aki a pickup-tól
//  X km-en belül van (users.last_known_lat/lng alapján). Az első,
//  aki a `POST /jobs/:id/instant-accept` végpontot eltalálja, nyer.
//
//  Miért nincs "zárás" / "foglalás" logika?
//    - A verseny önmagában motiváló: első nyer, a többinek a kliens
//      egy "Sajnos elkelt" üzenetet mutat.
//    - Atomi UPDATE szinten garantált (WHERE status='bidding' AND
//      carrier_id IS NULL AND is_instant=TRUE), így race condition-re
//      nincs szükség extra locking-ra.
// =====================================================================

const db = require('../db');
const { distanceMeters } = require('../utils/geo');
const { sendPushToUser } = require('./push');
const { createNotification } = require('./notifications');
const realtime = require('../realtime');

const DEFAULT_RADIUS_KM = 20;
// Maximum hány sofőrt push-olunk egyszerre. Ha egy városban 500 aktív
// sofőr van, egy azonnali fuvar nem ébreszti fel mindenkit (csak a top
// közelieket). Tereléses versenyt kerül.
const MAX_NOTIFICATIONS_PER_JOB = 40;

/**
 * Aktív, közeli sofőrök keresése egy adott pont körül.
 * "Aktív" kritérium: van regisztrált push token ÉS van last_known_lat/lng
 * (tehát egyszer már engedett GPS-t). A can_bid flag-et tiszteletben
 * tartjuk — lejárt jogosítvány esetén nem zavarjuk őket.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} shipperIdToExclude  — a feladó saját magát ne értesítse
 * @param {number} [radiusKm=20]
 * @returns {Promise<Array<{id:string, distance_km:number}>>}
 */
async function findNearbyActiveCarriers(lat, lng, shipperIdToExclude, radiusKm = DEFAULT_RADIUS_KM) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const latDeg = radiusKm / 111;
  const lngDeg = radiusKm / (111 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));

  // JOIN push_tokens: csak azokat a sofőröket értesítjük, akiknél van
  // regisztrált eszköz. Különben a push csak tömegesen menne a semmibe.
  const { rows } = await db.query(
    `SELECT DISTINCT u.id,
            u.last_known_lat AS lat,
            u.last_known_lng AS lng
       FROM users u
       JOIN push_tokens p ON p.user_id = u.id
      WHERE u.id <> $1
        AND u.last_known_lat IS NOT NULL
        AND u.last_known_lng IS NOT NULL
        AND COALESCE(u.can_bid, TRUE) = TRUE
        AND u.last_known_lat BETWEEN $2 AND $3
        AND u.last_known_lng BETWEEN $4 AND $5
      LIMIT $6`,
    [
      shipperIdToExclude,
      lat - latDeg, lat + latDeg,
      lng - lngDeg, lng + lngDeg,
      MAX_NOTIFICATIONS_PER_JOB * 2, // szórás után pontosan szűrünk
    ],
  );

  const out = [];
  for (const r of rows) {
    const d = distanceMeters(lat, lng, r.lat, r.lng) / 1000;
    if (d <= radiusKm) {
      out.push({ id: r.id, distance_km: +d.toFixed(2) });
    }
  }
  out.sort((a, b) => a.distance_km - b.distance_km);
  return out.slice(0, MAX_NOTIFICATIONS_PER_JOB);
}

/**
 * Értesíti a közeli sofőröket egy új azonnali fuvarról.
 * Fire-and-forget: soha nem dob hibát, a hívó háttérben futtassa.
 *
 * @param {object} job        — a frissen beszúrt jobs sor
 */
async function notifyNearbyCarriersOfInstantJob(job) {
  try {
    const radius = job.instant_radius_km || DEFAULT_RADIUS_KM;
    const carriers = await findNearbyActiveCarriers(
      job.pickup_lat, job.pickup_lng, job.shipper_id, radius,
    );
    if (carriers.length === 0) {
      console.log(`[instant] job ${job.id}: nincs közeli értesíthető sofőr (${radius} km)`);
      return;
    }
    const priceStr = (job.suggested_price_huf || 0).toLocaleString('hu-HU');
    for (const c of carriers) {
      // In-app notification (DB + Socket.IO + Expo push egyben)
      await createNotification({
        user_id: c.id,
        type: 'instant_job_nearby',
        title: '⚡ Azonnali fuvar a közelben!',
        body: `${priceStr} Ft — ${c.distance_km} km-re. Az első elfogadó nyer!`,
        link: `/sofor/fuvar/${job.id}`,
      }).catch(() => {});
    }
    // Globális "jobs:new-instant" event is, hogy a sofor/fuvarok oldalon
    // azonnal villogjon az új instant job (ne kelljen refresh).
    realtime.emitGlobal('jobs:new-instant', {
      job_id: job.id,
      title: job.title,
      pickup_address: job.pickup_address,
      dropoff_address: job.dropoff_address,
      pickup_lat: job.pickup_lat,
      pickup_lng: job.pickup_lng,
      suggested_price_huf: job.suggested_price_huf,
      instant_expires_at: job.instant_expires_at,
    });
    console.log(`[instant] job ${job.id}: ${carriers.length} közeli sofőr értesítve (${radius} km)`);
  } catch (err) {
    console.warn('[instant] notify hiba:', err.message);
  }
}

module.exports = {
  findNearbyActiveCarriers,
  notifyNearbyCarriersOfInstantJob,
  DEFAULT_RADIUS_KM,
};
