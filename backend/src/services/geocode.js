// =====================================================================
//  Szerveroldali geokódolás — szövegből (pl. "Eger") koordináta.
//
//  OpenStreetMap Nominatim-ot használunk: nincs hozzá API kulcs, és egy
//  ritka művelethez (útvonal-figyelő létrehozása) bőven elég. Magyarországra
//  szűrve a városneveket megbízhatóan felismeri. A Nominatim házirendje
//  miatt küldünk egy beazonosító User-Agent-et, és időkorlátot teszünk rá.
//
//  Fontos: ez KÉNYELMI funkció. Az elsődleges út a kliensoldali
//  cím-kiegészítő (Google Places), ami pontos koordinátát ad — ez csak
//  akkor lép be, ha a user beírta a várost, de nem választott a listából.
// =====================================================================

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/**
 * @param {string} text – pl. "Eger" vagy "Budapest, XI. kerület"
 * @returns {Promise<{lat:number, lng:number, formatted:string}|null>}
 */
async function geocodeAddress(text) {
  if (!text || !String(text).trim()) return null;
  const q = String(text).trim();

  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=hu`
    + `&accept-language=hu&q=${encodeURIComponent(q)}`;

  // Időkorlát, hogy egy lassú geokóder ne fogja meg a kérést
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GoFuvar/1.0 (+https://gofuvar.hu)' },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const lat = parseFloat(arr[0].lat);
    const lng = parseFloat(arr[0].lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, formatted: arr[0].display_name || q };
  } catch {
    // hálózati hiba / timeout → null, a hívó dönt mit tesz
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { geocodeAddress };
