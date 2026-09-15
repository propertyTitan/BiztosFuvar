// =====================================================================
//  Adatvesztés-védelem: van-e a felhasználónak olyan ügylete, ami miatt a
//  fiók-törlése (admin VAGY self-service) tiltandó?
//
//  KÉT eset zárja a törlést:
//   (1) AKTÍV + FIZETETT job VAGY booking (bármelyik oldalon) — a törlés
//       kaszkádol (users → carrier_routes → route_bookings), így egy
//       szállító törlése MÁS feladók kifizetett foglalásait is elvinné.
//   (2) DISPUTED job VAGY booking (paid_at-tól függetlenül) — a vitás
//       ügylet fotó-/chat-bizonyítékát a photo_retention_hold 5 évig őrzi;
//       a törlés CASCADE ezt kiürítené (a jogi igény érvényesítése a
//       GDPR 17(3)e szerint kivétel az elfeledtetéshez való jog alól).
//
//   (3) ZÁROLT BIZONYÍTÉK (photo_retention_hold = TRUE) — LEZÁRT ügyleten is
//       (2026-09-11, Codex-audit P0-06): a vita lezárása után a zárolás
//       szándékosan megmarad (5 év, ÁSZF + tájékoztató), a fióktörlés CASCADE-je
//       viszont a fotókat/chatet vitte volna. Két ígéret ütközött; a
//       megőrzés nyer — a törlés a zárolás lejártáig ügyfélszolgálati ügy.
//
//  Előbb le kell zárni az ügyletet (kézbesítés / lemondás / vita), utána
//  a törlés szabad. Az admin-törlés, a self-delete ÉS az alvó-fiók auto-purge
//  UGYANEZT használja.
// =====================================================================

const db = require('../db');

/**
 * @param {string} userId
 * @returns {Promise<boolean>} true = a törlést blokkolni kell
 */
async function userHasBlockingDealings(userId, client = db) {
  const { rows } = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM jobs
          WHERE (shipper_id = $1 OR carrier_id = $1)
            AND ((paid_at IS NOT NULL
                  AND status NOT IN ('delivered', 'completed', 'cancelled'))
                 OR status = 'disputed'
                 OR photo_retention_hold = TRUE))
     + (SELECT COUNT(*) FROM route_bookings b
          JOIN carrier_routes r ON r.id = b.route_id
          WHERE (b.shipper_id = $1 OR r.carrier_id = $1)
            AND ((b.paid_at IS NOT NULL
                  AND b.status NOT IN ('delivered', 'cancelled', 'rejected'))
                 OR b.status = 'disputed'
                 OR b.photo_retention_hold = TRUE))
     + (SELECT COUNT(*) FROM payment_sessions p
          WHERE (p.shipper_id = $1 OR p.carrier_id = $1
             OR EXISTS (SELECT 1 FROM jobs j WHERE j.id = p.job_id AND j.carrier_id = $1)
             OR EXISTS (SELECT 1 FROM route_bookings b JOIN carrier_routes r ON r.id = b.route_id
                         WHERE b.id = p.booking_id AND (b.shipper_id = $1 OR r.carrier_id = $1)))
            AND p.state IN ('pending', 'needs_review')) AS n`,
    [userId],
  );
  return Number(rows[0]?.n || 0) > 0;
}

module.exports = { userHasBlockingDealings };
