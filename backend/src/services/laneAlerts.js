// =====================================================================
//  Szállító útvonal-figyelők illesztése + értesítés.
//
//  Új licitálható fuvar létrejöttekor a jobs.js fire-and-forget hívja a
//  notifyMatchingAlerts(job)-ot. Minden aktív figyelőre megnézzük, hogy a
//  fuvar illeszkedik-e (felvételi a sugáron belül, ha van cél akkor az is,
//  ár/súly szűrő), és a szállítónak EMAIL + in-app értesítést küldünk.
//  SMS-t SOHA nem küldünk innen (költség).
// =====================================================================

const realDb = require('../db');
const { distanceMeters } = require('../utils/geo');
const { createNotification } = require('./notifications');
const { sendLaneAlertEmail } = require('./email');

/**
 * Megnézi, illeszkedik-e a fuvar egy figyelőre.
 * @returns {boolean}
 */
function jobMatchesAlert(job, alert) {
  // Felvételi pontnak a figyelő felvételi körén belül kell lennie
  const fromDistKm = distanceMeters(job.pickup_lat, job.pickup_lng, alert.from_lat, alert.from_lng) / 1000;
  if (fromDistKm > alert.radius_km) return false;

  // Ha a figyelőnek van célterülete, a lerakodásnak is illeszkednie kell
  if (alert.to_lat != null && alert.to_lng != null) {
    const toDistKm = distanceMeters(job.dropoff_lat, job.dropoff_lng, alert.to_lat, alert.to_lng) / 1000;
    if (toDistKm > alert.radius_km) return false;
  }

  // Ár-szűrő: a javasolt ár érje el a minimumot (ha a fuvarnak van ára)
  if (alert.min_price_huf != null && job.suggested_price_huf != null
      && job.suggested_price_huf < alert.min_price_huf) {
    return false;
  }

  // Súly-szűrő: a fuvar ne legyen nehezebb a szállító maximumánál
  if (alert.max_weight_kg != null && job.weight_kg != null
      && Number(job.weight_kg) > alert.max_weight_kg) {
    return false;
  }

  return true;
}

/**
 * Egy frissen létrehozott fuvarra illeszkedő összes figyelő szállítóének
 * értesítés (email + in-app). Soha nem dob hibát — fire-and-forget.
 */
async function notifyMatchingAlerts(job) {
  try {
    // Aktív figyelők + a szállító neve/emailje. A saját fuvarra ne szóljon.
    const { rows: alerts } = await realDb.query(
      `SELECT a.*, u.email AS carrier_email, u.full_name AS carrier_name
         FROM carrier_alerts a
         JOIN users u ON u.id = a.carrier_id
        WHERE a.active = TRUE
          AND a.carrier_id <> $1`,
      [job.shipper_id],
    );
    if (!alerts.length) return;

    // Egy szállító több figyelője is illeszkedhet — szállítónként csak EGY értesítés.
    const notifiedCarriers = new Set();

    for (const alert of alerts) {
      if (notifiedCarriers.has(alert.carrier_id)) continue;
      if (!jobMatchesAlert(job, alert)) continue;
      notifiedCarriers.add(alert.carrier_id);

      const routeLabel = `${job.pickup_address} → ${job.dropoff_address}`;
      const link = `/sofor/fuvar/${job.id}`;

      await createNotification({
        user_id: alert.carrier_id,
        type: 'lane_alert',
        title: '🎯 Új fuvar a figyelt útvonaladon!',
        body: `${job.title} — ${routeLabel}${job.suggested_price_huf ? ` · ~${Number(job.suggested_price_huf).toLocaleString('hu-HU')} Ft` : ''}`,
        link,
      });

      // Email (Resend) — fire-and-forget, kulcs híján stub (csak logol)
      setImmediate(() => {
        sendLaneAlertEmail({
          to: alert.carrier_email,
          carrierName: alert.carrier_name,
          jobTitle: job.title,
          jobId: job.id,
          routeLabel,
          priceHuf: job.suggested_price_huf,
        }).catch((e) => console.warn('[laneAlerts] email hiba:', e.message));
      });
    }

    if (notifiedCarriers.size > 0) {
      console.log(`[laneAlerts] job ${job.id}: ${notifiedCarriers.size} szállító értesítve`);
    }
  } catch (err) {
    console.error('[laneAlerts] notifyMatchingAlerts hiba:', err.message);
  }
}

module.exports = { notifyMatchingAlerts, jobMatchesAlert };
