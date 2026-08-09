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
//  Előbb le kell zárni az ügyletet (kézbesítés / lemondás / vita), utána
//  a törlés szabad. Az admin-törlés és a self-delete UGYANEZT használja.
// =====================================================================

const db = require('../db');

/**
 * @param {string} userId
 * @returns {Promise<boolean>} true = a törlést blokkolni kell
 */
async function userHasBlockingDealings(userId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM jobs
          WHERE (shipper_id = $1 OR carrier_id = $1)
            AND ((paid_at IS NOT NULL
                  AND status NOT IN ('delivered', 'completed', 'cancelled'))
                 OR status = 'disputed'))
     + (SELECT COUNT(*) FROM route_bookings b
          JOIN carrier_routes r ON r.id = b.route_id
          WHERE (b.shipper_id = $1 OR r.carrier_id = $1)
            AND ((b.paid_at IS NOT NULL
                  AND b.status NOT IN ('delivered', 'cancelled', 'rejected'))
                 OR b.status = 'disputed')) AS n`,
    [userId],
  );
  return Number(rows[0]?.n || 0) > 0;
}

module.exports = { userHasBlockingDealings };
