// Földrajzi segédfüggvények (Haversine távolság méterben).

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Két GPS koordináta közti távolság méterben (Haversine).
 */
function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Érvényes koordináta-pár? Szám vagy nem üres számszöveg, lat -90..90,
 * lng -180..180 (2026-09-28, audit P1). A fuvarnál csak az EGYIK pontnak kell
 * a lefedettségi zónában lennie — a másik eddig bármilyen szám lehetett, és a
 * (kerekített) koordináta a díj ELŐTT minden szállítóhoz eljut: egy
 * „630123456" szélesség egy mobilszámot vitt át a díj-kapun.
 */
function ervenyesKoordinata(lat, lng) {
  const szam = (v) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
  const la = szam(lat);
  const ln = szam(lng);
  return Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

module.exports = { distanceMeters, ervenyesKoordinata };
