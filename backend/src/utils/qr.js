// =====================================================================
//  QR kód generátor a delivery code-hoz.
//
//  A feladó/címzett megmutatja a QR kódot → a sofőr scan-eli a
//  mobilján → fuvar lezárva. Gyorsabb és profibb mint a 6 jegyű
//  számot diktálni.
//
//  Megvalósítás: a QR kód tartalmát a szerveren generáljuk SVG-ként
//  (nincs külső dependency — saját minimális QR encoder). A kliens
//  oldalon viszont a delivery_code-ból generáljuk JavaScript-ben,
//  így a szerverre nem kell extra endpoint.
//
//  A QR tartalom: `gofuvar:deliver:<jobId>:<deliveryCode>`
//  A sofőr appja ezt parse-olja, és a kódot automatikusan elküldi
//  a POST /jobs/:jobId/photos végpontra delivery_code-ként.
// =====================================================================

/**
 * QR kód tartalom formátum generálása.
 * Ezt a stringet kódoljuk QR-be a kliens oldalon.
 */
function qrContent(jobId, deliveryCode) {
  return `gofuvar:deliver:${jobId}:${deliveryCode}`;
}

/**
 * QR tartalom parse-olása a sofőr oldalon.
 * @returns {{ jobId: string, deliveryCode: string } | null}
 */
function parseQrContent(content) {
  if (!content || typeof content !== 'string') return null;
  const match = content.match(/^gofuvar:deliver:([^:]+):(\d{6})$/);
  if (!match) return null;
  return { jobId: match[1], deliveryCode: match[2] };
}

module.exports = { qrContent, parseQrContent };
