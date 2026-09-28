// =====================================================================
//  Napi levél-keretek — a Resend-kvóta védelme (2026-09-28, audit P1 — R2-2).
//
//  A feladáskori címzetti levél (fuvar + járat-foglalás) a kérésben megadott,
//  MEG NEM ERŐSÍTETT címre megy, a lane-alert pedig minden illeszkedő
//  szállítónak — egyetlen megerősített fiók így (lemondással ingyen
//  ismételve) percek alatt elégethette a Resend napi/havi kvótáját. Utána a
//  regisztrációs megerősítő és a jelszó-visszaállító levél sem ment ki, a
//  `requireVerifiedEmail` pedig minden új felhasználó írását blokkolta.
//
//  A feladáskori címzetti levél TÁJÉKOZTATÓ (az átvételi kód a felvételkor
//  megy, e-mailben és SMS-ben — photos.js / pickupNotifications.js), ezért a
//  keret felett a fuvar létrejön, csak ez a levél marad ki. Migráció nincs: a
//  keretet a meglévő sorokból számoljuk (created_at-alapú, tehát a lemondás
//  nem szabadít fel semmit).
//
//  Hangolás (env, nem-negatív egész; üres/hibás → alapérték):
//    RECIPIENT_EMAIL_DAILY_CAP_PER_USER      (alap 10 / feladó / 24 h)
//    RECIPIENT_EMAIL_DAILY_CAP               (alap 60 / platform / 24 h)
//    LANE_ALERT_EMAIL_DAILY_CAP_PER_CARRIER  (alap 20 / szállító / 24 h)
// =====================================================================

const db = require('../db');

function napiKeret(nev, alap) {
  const raw = process.env[nev];
  if (raw === undefined || raw === null || String(raw).trim() === '') return alap;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : alap;
}

function keretek() {
  return {
    cimzettFeladonkent: napiKeret('RECIPIENT_EMAIL_DAILY_CAP_PER_USER', 10),
    cimzettPlatform: napiKeret('RECIPIENT_EMAIL_DAILY_CAP', 60),
    laneAlertSzallitonkent: napiKeret('LANE_ALERT_EMAIL_DAILY_CAP_PER_CARRIER', 20),
  };
}

// A platform-keret átlépése óránként legfeljebb EGY Sentry-figyelmeztetés,
// a közben kimaradt levelek számával (az email.js riasztás-fojtás mintája).
const RIASZTAS_ABLAK_MS = 60 * 60 * 1000;
const platformRiasztas = { kimaradt: 0, utolso: 0 };

function riasztPlatformKeret(osszes, keret) {
  platformRiasztas.kimaradt += 1;
  const most = Date.now();
  if (most - platformRiasztas.utolso < RIASZTAS_ABLAK_MS) return;
  const kimaradt = platformRiasztas.kimaradt;
  platformRiasztas.kimaradt = 0;
  platformRiasztas.utolso = most;
  try {
    const Sentry = require('@sentry/node');
    Sentry.captureMessage(
      `[email] a feladáskori címzetti levelek platform-szintű napi kerete betelt — ${kimaradt} levél kimaradt`,
      {
        level: 'warning',
        tags: { csatorna: 'email', keret: 'cimzett-platform' },
        extra: { utolso_24_ora: osszes, keret },
      },
    );
  } catch { /* a riasztás hibája sosem érintheti a fuvarfeladást */ }
}

/**
 * Mehet-e a feladáskori címzetti levél? A hívás a fuvar/foglalás beszúrása
 * UTÁN fut, tehát a számlálás a mostanit is tartalmazza (11. > 10 → kimarad).
 * Hibánál false: a levél tájékoztató, a kvóta védelme az erősebb szempont.
 */
async function cimzettiLevelMehet(shipperId) {
  const { cimzettFeladonkent, cimzettPlatform } = keretek();
  try {
    const { rows } = await db.query(
      `SELECT
         (SELECT COUNT(*) FROM jobs
           WHERE recipient_email IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours' AND shipper_id = $1)
       + (SELECT COUNT(*) FROM route_bookings
           WHERE recipient_email IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours' AND shipper_id = $1)
           AS sajat,
         (SELECT COUNT(*) FROM jobs
           WHERE recipient_email IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours')
       + (SELECT COUNT(*) FROM route_bookings
           WHERE recipient_email IS NOT NULL AND created_at > NOW() - INTERVAL '24 hours')
           AS osszes`,
      [shipperId],
    );
    const sajat = Number(rows[0].sajat);
    const osszes = Number(rows[0].osszes);
    if (sajat > cimzettFeladonkent) {
      console.warn(`[recipient] a feladó napi címzetti levél-kerete betelt (${sajat}/${cimzettFeladonkent}) — a feladáskori levél kimarad`);
      return false;
    }
    if (osszes > cimzettPlatform) {
      console.warn(`[recipient] a platform napi címzetti levél-kerete betelt (${osszes}/${cimzettPlatform}) — a feladáskori levél kimarad`);
      riasztPlatformKeret(osszes, cimzettPlatform);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[recipient] a levél-keret nem ellenőrizhető — a feladáskori levél kimarad:', e.message);
    return false;
  }
}

/**
 * Mehet-e még lane-alert E-MAIL ennek a szállítónak? Az in-app értesítés
 * ettől függetlenül megy; a számlálás a MEGLÉVŐ `lane_alert` értesítés-sorokból
 * történik, ezért a hívás az aktuális értesítés beszúrása ELŐTT fut.
 */
async function laneAlertLevelMehet(carrierId) {
  const { laneAlertSzallitonkent } = keretek();
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS db FROM notifications
        WHERE user_id = $1 AND type = 'lane_alert' AND created_at > NOW() - INTERVAL '24 hours'`,
      [carrierId],
    );
    return rows[0].db < laneAlertSzallitonkent;
  } catch (e) {
    console.warn('[laneAlerts] a levél-keret nem ellenőrizhető — az e-mail kimarad:', e.message);
    return false;
  }
}

/** Tesztekhez: a riasztás-fojtás nullázása. */
function __resetLevelKeretForTests() {
  platformRiasztas.kimaradt = 0;
  platformRiasztas.utolso = 0;
}

module.exports = { keretek, cimzettiLevelMehet, laneAlertLevelMehet, __resetLevelKeretForTests };
