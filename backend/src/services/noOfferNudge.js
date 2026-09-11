// =====================================================================
//  „NINCS AJÁNLAT" NUDGE (2026-09-11, teljes audit B3)
//
//  A feladó feladta a fuvart, és 24 óra alatt senki nem tett ajánlatot —
//  eddig SEMMI nem történt: a hirdetés csendben állt, a feladó nem tudta,
//  hogy az ára alacsony, az időablak szűk vagy a leírás hiányos. A launch
//  kínálati oldala vékony lesz, ezért ez a legnagyobb lemorzsolódási pont.
//  Napi kör: bidding + 24 h + 0 ajánlat + még nem küldtünk → egyszeri
//  in-app + e-mail három konkrét tippel és a szerkesztés linkjével.
//  Atomi claim (no_offer_nudge_at), így két kör sem küld duplán.
// =====================================================================
const db = require('../db');
const { createNotification } = require('./notifications');

const NUDGE_AFTER_HOURS = Number(process.env.NO_OFFER_NUDGE_AFTER_HOURS) || 24;

async function runNoOfferNudges() {
  let kuldve = 0;
  const { rows } = await db.query(
    `SELECT j.id, j.title, j.shipper_id, j.suggested_price_huf,
            s.email AS shipper_email, s.full_name AS shipper_name
       FROM jobs j
       JOIN users s ON s.id = j.shipper_id
      WHERE j.status = 'bidding'
        AND j.no_offer_nudge_at IS NULL
        AND j.created_at < NOW() - ($1 || ' hours')::interval
        AND NOT EXISTS (SELECT 1 FROM bids b WHERE b.job_id = j.id)
      LIMIT 500`,
    [NUDGE_AFTER_HOURS],
  );
  for (const j of rows) {
    try {
      const claim = await db.query(
        `UPDATE jobs SET no_offer_nudge_at = NOW()
          WHERE id = $1 AND no_offer_nudge_at IS NULL AND status = 'bidding'
          RETURNING id`,
        [j.id],
      );
      if (claim.rowCount === 0) continue;
      kuldve += 1;
      const link = `/dashboard/fuvar/${j.id}`;
      await createNotification({
        user_id: j.shipper_id,
        type: 'no_offer_nudge',
        title: '💡 Még nincs ajánlat a fuvarodra — 3 tipp',
        body: `A(z) "${j.title || 'fuvar'}" fuvarra ${NUDGE_AFTER_HOURS} óra alatt nem érkezett ajánlat. Segíthet: (1) emeld kicsit az ajánlott árat, (2) adj tágabb felvételi időablakot, (3) pontosítsd a leírást és tegyél fel fotót. A fuvart a részletek oldalán szerkesztheted.`,
        link,
      });
      if (j.shipper_email) {
        const { sendEmail, wrapHtml, escapeHtml } = require('./email');
        const baseUrl = process.env.PUBLIC_URL || 'https://www.gofuvar.hu';
        await sendEmail({
          to: j.shipper_email,
          subject: '💡 Még nincs ajánlat a fuvarodra — így jön gyorsabban',
          html: wrapHtml({
            heading: 'Még nincs ajánlat — 3 tipp',
            bodyHtml: `<p>Szia${j.shipper_name ? ` ${escapeHtml(j.shipper_name)}` : ''}!</p>`
              + `<p>A(z) <strong>${escapeHtml(j.title || 'fuvar')}</strong> fuvarodra ${NUDGE_AFTER_HOURS} óra alatt nem érkezett ajánlat. A szállítók a listában az ár, az időablak és a leírás alapján döntenek — ezen a hármon múlik a legtöbb:</p>`
              + '<ol>'
              + `<li><strong>Ár:</strong> ${j.suggested_price_huf ? `a jelenlegi ${Number(j.suggested_price_huf).toLocaleString('hu-HU')} Ft-ot emeld 10–20%-kal` : 'adj meg ajánlott árat'} — a szállító üzemanyagot és időt számol.</li>`
              + '<li><strong>Időablak:</strong> minél tágabb a felvételi időablak, annál több szállítónak esik útba.</li>'
              + '<li><strong>Leírás + fotó:</strong> méret, súly, megközelítés (emelet, lift) és egy fotó — a bizonytalan hirdetésre nem tesznek ajánlatot.</li>'
              + '</ol>',
            ctaText: 'Fuvar szerkesztése',
            ctaHref: `${baseUrl}${link}`,
          }),
        });
      }
    } catch (err) {
      console.error(`[no-offer-nudge] fuvar ${j.id} hiba:`, err.message);
    }
  }
  if (kuldve > 0) console.log(`[no-offer-nudge] ${kuldve} „nincs ajánlat" tipp elküldve`);
  return kuldve;
}

module.exports = { runNoOfferNudges, NUDGE_AFTER_HOURS };
