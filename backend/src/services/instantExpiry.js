// =====================================================================
//  LEJÁRT AZONNALI FUVAROK (2026-09-11, teljes audit C1)
//
//  Az azonnali („UberFuvar") fuvar 30–240 perces ablakot kap; a feed a
//  lejárt ablakot kiszűrte, de maga a fuvar ÖRÖKRE 'bidding' + is_instant
//  maradt: a feladó „Ajánlatokat vár"-t látott egy hirdetésen, amit senki
//  nem lát. Óránkénti kör: a lejárt azonnali fuvar NORMÁL ajánlatgyűjtésre
//  vált (is_instant=false) — a kereslet a piactéren marad —, a feladó
//  értesítést kap. Feltételes UPDATE: közben elfogadott fuvarhoz nem nyúl.
// =====================================================================
const db = require('../db');
const { createNotification } = require('./notifications');
const realtime = require('../realtime');

async function runInstantExpiry() {
  const { rows } = await db.query(
    `UPDATE jobs
        SET is_instant = FALSE, instant_expires_at = NULL, updated_at = NOW()
      WHERE status = 'bidding' AND is_instant = TRUE
        AND instant_expires_at IS NOT NULL AND instant_expires_at < NOW()
      RETURNING id, title, shipper_id`,
  );
  for (const j of rows) {
    createNotification({
      user_id: j.shipper_id,
      type: 'instant_expired',
      title: 'Az azonnali fuvar ablaka lejárt — normál ajánlatgyűjtésre váltott',
      body: `A(z) "${j.title || 'fuvar'}" azonnali fuvarra a megadott időn belül nem jelentkezett szállító. A hirdetés nem veszett el: normál fuvarként a szállítók ajánlatot tehetnek rá — ha sürgős, emeld az árat vagy add fel újra azonnali fuvarként.`,
      link: `/dashboard/fuvar/${j.id}`,
    }).catch(() => {});
    realtime.emitToJob(j.id, 'job:updated', { job_id: j.id });
  }
  if (rows.length > 0) console.log(`[instant-expiry] ${rows.length} lejárt azonnali fuvar normál ajánlatgyűjtésre váltott`);
  return rows.length;
}

module.exports = { runInstantExpiry };
