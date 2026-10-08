// =====================================================================
//  Navigációs linkek a szállítónak (UX Q06, 2026-10-08)
//
//  A díj után a szállító a pontos címet csak szövegként látta — telefonról,
//  vezetés előtt be kellett másolnia a térképbe. Most egy koppintás: Google
//  Maps útvonaltervezés a pontos koordinátára (a díj után a backend a pontos
//  pontot adja; előtte a kerekítettet — ezért a hívó csak paid_at után
//  mutatja), és Waze. Külső link: új lapon, noopener.
// =====================================================================

function ervenyes(lat: unknown, lng: unknown): lat is number {
  // ⚠️ Number(null) === 0, és az VÉGES — a projekt ismert csapdája (a SOS a
  // (0,0) pontra került emiatt). A hiányzó értéket előbb kiszűrjük.
  if (lat == null || lng == null || lat === '' || lng === '') return false;
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180
    && !(a === 0 && b === 0);
}

/** Google Maps útvonaltervezés a célpontra (autóval). */
export function googleNavigacio(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (!ervenyes(lat, lng)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lng)}&travelmode=driving`;
}

/** Waze navigáció a célpontra. */
export function wazeNavigacio(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (!ervenyes(lat, lng)) return null;
  return `https://waze.com/ul?ll=${Number(lat)},${Number(lng)}&navigate=yes`;
}
