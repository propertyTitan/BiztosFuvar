// =====================================================================
//  Ár-kalkulátor — regisztráció NÉLKÜL elérhető.
//
//  A főoldalon a látogató beírja: honnan, hova, mekkora csomag →
//  kap egy becsült ársávot. Ez a konverzió-optimalizálás: aki árat lát,
//  az regisztrál. Amíg nincs elég valós adat, fix Ft/km + Ft/kg
//  képlettel dolgozunk.
// =====================================================================

const express = require('express');
const { distanceMeters } = require('../utils/geo');

const router = express.Router();

// Fix árazási képlet (amíg nincs elég valós tranzakció az ML-hez):
//   alap = 1500 Ft
//   + távolság × 45 Ft/km
//   + súly × 30 Ft/kg
//   szorozva a csomagméret (térfogat) szorzóval — egy szekrény több
//   járműhelyet/kezelést igényel, mint egy boríték azonos súlynál
//   + emelet × 500 Ft (ha nincs lift) / × 200 Ft (ha van lift)
//
// Az ársáv: -20% … +20% a számított ár körül, 500-asra kerekítve.
//
// KALIBRÁCIÓ: ezek a paraméterek egy helyen, könnyen hangolhatók. A 90 Ft/km
// tudatos középút (2026-06): reális annyira, hogy a sofőrök licitáljanak rá,
// de még a profi költöztető díjak alatt. A "csak megy arra" közösségi esetnél
// alacsonyabb (~45) is indokolt lehet, a dedikált önköltség (~130) magasabb.
// A valós medián a lezárt fuvarok adatából később felülírja ezt a horgonyt.
const BASE_HUF          = 1500;
const PER_KM_HUF        = 90;
const PER_KG_HUF        = 30;
const PER_FLOOR_NO_LIFT  = 500;
const PER_FLOOR_WITH_LIFT = 200;

// Térfogat-alapú méretszorzó (m³). Tunable.
function sizeMultiplier(volumeM3) {
  if (!Number.isFinite(volumeM3) || volumeM3 <= 0) return 1.0;
  if (volumeM3 >= 1.0)  return 1.6;  // nagy bútor
  if (volumeM3 >= 0.25) return 1.3;
  if (volumeM3 >= 0.05) return 1.15;
  return 1.0;                        // kis csomag
}

// GET /calculator/estimate — publikus, nem kell auth
router.get('/calculator/estimate', (req, res) => {
  const {
    pickup_lat, pickup_lng,
    dropoff_lat, dropoff_lng,
    weight_kg,
    pickup_floor, pickup_has_elevator,
    dropoff_floor, dropoff_has_elevator,
    volume_m3,
  } = req.query;

  const pLat = parseFloat(pickup_lat);
  const pLng = parseFloat(pickup_lng);
  const dLat = parseFloat(dropoff_lat);
  const dLng = parseFloat(dropoff_lng);
  const kg   = parseFloat(weight_kg) || 5;
  const volM3 = parseFloat(volume_m3);

  if (!Number.isFinite(pLat) || !Number.isFinite(pLng) ||
      !Number.isFinite(dLat) || !Number.isFinite(dLng)) {
    return res.status(400).json({ error: 'Hiányzó koordináták' });
  }

  const distKm = +(distanceMeters(pLat, pLng, dLat, dLng) / 1000).toFixed(2);

  // Méretszorzó a táv+alap+súly komponensre; a cipelés-felár külön jön.
  const mult = sizeMultiplier(volM3);
  let estimate = (BASE_HUF + distKm * PER_KM_HUF + kg * PER_KG_HUF) * mult;

  const pFloor = Math.max(0, Math.min(10, parseInt(pickup_floor) || 0));
  const dFloor = Math.max(0, Math.min(10, parseInt(dropoff_floor) || 0));
  if (pFloor > 0) {
    estimate += pFloor * (pickup_has_elevator === 'true' ? PER_FLOOR_WITH_LIFT : PER_FLOOR_NO_LIFT);
  }
  if (dFloor > 0) {
    estimate += dFloor * (dropoff_has_elevator === 'true' ? PER_FLOOR_WITH_LIFT : PER_FLOOR_NO_LIFT);
  }

  estimate = Math.round(estimate);
  const low  = Math.round(estimate * 0.8);
  const high = Math.round(estimate * 1.2);

  // Kerekítés szép számokra (500-asokra)
  const roundTo500 = (n) => Math.round(n / 500) * 500;

  res.json({
    distance_km: distKm,
    weight_kg: kg,
    estimate_huf: roundTo500(estimate),
    range_low_huf: roundTo500(low),
    range_high_huf: roundTo500(high),
    note: 'Becsült ár a távolság, súly és csomagméret alapján. A tényleges ár a sofőrök licitjeitől függ.',
  });
});

module.exports = router;
