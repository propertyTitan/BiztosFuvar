// =====================================================================
//  A díjfizetés UTÁNI értesítések — egy közös, pontosan egyszeri helper
//  (2026-09-29, CIB PR-1)
//
//  Eddig három út (webhook, kézi fuvar-nyugtázás, kézi foglalás-nyugtázás)
//  maga írta meg az értesítéseit, és a három szétcsúszott:
//    - a webhook-ágon a díj-visszaigazolásból hiányzott a fuvardíj
//      (a lekérdezés nem kérte le az accepted_price_huf-ot), a „Fizetés
//      időpontja" a küldés pillanata volt a könyvelt paid_at helyett, és a
//      szállító nem kapott levelet;
//    - ismételt könyvelésnél (alreadyBooked, átvett claim, a párhuzamos kézi
//      nyugtázás vesztese) MINDEN levél, in-app értesítés és socket újra
//      kiment;
//    - újranyitási verseny után a kézi út a kérés elején beolvasott, azóta
//      visszalépett szállítónak írt „Indulhat a fuvar!"-t.
//
//  Most MINDEN díjkönyvelő út ezt hívja, a könyvelés UTÁN. A döntés a
//  díjbizonylaton születik: az `UPDATE … SET notifications_sent_at = NOW()
//  WHERE … IS NULL` claim egyetlen hívónak sikerül, a többi semmit nem küld.
//  A címzettek és a tartalom a claim UGYANAZON utasításában olvasódnak ki
//  (CTE) — tehát a claim pillanatában tárolt szállító kap értesítést, a
//  levélben a bizonylat összege és időpontja áll.
//
//  Szándékosan „legfeljebb egyszer": a claim a küldés ELŐTT íródik. Egy
//  kiesett levél nem ismétlődik; a dupla levél viszont kizárt. Soha nem dob —
//  a fizetés már könyvelve van, egy értesítés hibája nem bukhatja a hívót.
//  Őr: tests/cib-pr1-ertesitesek.test.js.
// =====================================================================
const db = require('../db');
const realtime = require('../realtime');
const { createNotification } = require('./notifications');
// A levelező modult a hívás pillanatában olvassuk (email.xxx(...)), nem
// destrukturálva: így a teszt-üzemi hiba-injektálás és a jövőbeli CIB-ág
// ugyanazt a csatornát látja.
const email = require('./email');

function riaszt(uzenet, err) {
  console.error(uzenet, err?.message || err);
  try {
    require('@sentry/node').captureMessage(uzenet, {
      level: 'error',
      tags: { csatorna: 'fizetes', hibamod: 'dij_ertesites' },
    });
  } catch { /* nincs Sentry */ }
}

/** Levél a háttérben: a válasz nem vár rá, és a hibája (akár szinkron) sem szabadul el. */
function hatterben(kuld, cimke) {
  setImmediate(() => {
    try {
      Promise.resolve(kuld()).catch((e) => console.warn(`[email] ${cimke} hiba:`, e?.message));
    } catch (e) {
      console.warn(`[email] ${cimke} hiba:`, e?.message);
    }
  });
}

/**
 * A díjfizetés utáni értesítések kiküldése egy díjbizonylathoz — pontosan
 * egyszer. Visszaad: `{ kuldve: true }`, ha ez a hívás nyerte a claimet,
 * különben `{ kuldve: false }`.
 * @param {string} paymentId — a fee_payment_receipts.payment_id
 */
async function dijFizetesUtaniErtesitesek(paymentId) {
  let sor;
  try {
    const { rows } = await db.query(
      `WITH claim AS (
         UPDATE fee_payment_receipts SET notifications_sent_at = NOW()
          WHERE payment_id = $1 AND notifications_sent_at IS NULL
          RETURNING payment_id, job_id, booking_id, shipper_id, fee_huf, paid_at
       )
       SELECT claim.*,
              j.title AS job_title, j.carrier_id AS job_carrier_id, j.accepted_price_huf,
              b.route_id, b.price_huf AS booking_price_huf,
              r.title AS route_title, r.carrier_id AS route_carrier_id,
              s.full_name AS shipper_name, s.email AS shipper_email,
              c.full_name AS carrier_name, c.email AS carrier_email
         FROM claim
    LEFT JOIN jobs j ON j.id = claim.job_id
    LEFT JOIN route_bookings b ON b.id = claim.booking_id
    LEFT JOIN carrier_routes r ON r.id = b.route_id
    LEFT JOIN users s ON s.id = claim.shipper_id
    LEFT JOIN users c ON c.id = COALESCE(j.carrier_id, r.carrier_id)`,
      [paymentId],
    );
    sor = rows[0];
  } catch (err) {
    riaszt('[fee-notify] a díjfizetés utáni értesítés claimje elbukott — nem küldünk (inkább egyszer se, mint kétszer)', err);
    return { kuldve: false };
  }
  if (!sor) return { kuldve: false };

  try {
    const fuvar = !!sor.job_id;
    if (!fuvar && !sor.booking_id) return { kuldve: true }; // az ügylet azóta törölve
    const cim = fuvar ? sor.job_title : sor.route_title;
    const fuvardij = fuvar ? sor.accepted_price_huf : sor.booking_price_huf;
    const szallitoId = fuvar ? sor.job_carrier_id : sor.route_carrier_id;
    const feladoId = sor.shipper_id;
    const paidAtIso = new Date(sor.paid_at).toISOString();
    const esemeny = fuvar ? 'job:paid' : 'route-booking:paid';
    const payload = fuvar
      ? { job_id: sor.job_id, paid_at: paidAtIso }
      : { booking_id: sor.booking_id, paid_at: paidAtIso };
    const fuvardijSzoveg = fuvardij ? ` (${Number(fuvardij).toLocaleString('hu-HU')} Ft)` : '';

    // 1) A SZÁLLÍTÓ — a claim pillanatában tárolt (újranyitott fuvarnál nincs)
    if (szallitoId) {
      await createNotification(fuvar ? {
        user_id: szallitoId,
        type: 'job_paid',
        title: '🤝 Indulhat a fuvar!',
        body: `${sor.shipper_name || 'A feladó'} kifizette a kapcsolatfelvételi díjat a(z) "${cim}" fuvarhoz. Mostantól látjátok egymás elérhetőségét — a fuvardíjat${fuvardijSzoveg} közvetlenül a feladótól kapod (készpénz vagy átutalás, ahogy megegyeztek).`,
        link: `/sofor/fuvar/${sor.job_id}`,
      } : {
        user_id: szallitoId,
        type: 'booking_paid',
        title: '🤝 Indulhat a foglalás!',
        body: `${sor.shipper_name || 'A feladó'} kifizette a kapcsolatfelvételi díjat a(z) "${cim}" foglaláshoz. A fuvardíjat${fuvardijSzoveg} közvetlenül a feladótól kapod (készpénz vagy átutalás, ahogy megegyeztek).`,
        link: `/sofor/utvonal/${sor.route_id}`,
      }).catch(() => {});
      if (sor.carrier_email) {
        hatterben(() => (fuvar
          ? email.sendJobPaidEmail({
            to: sor.carrier_email,
            carrierName: sor.carrier_name,
            jobTitle: cim,
            jobId: sor.job_id,
            amountHuf: fuvardij,
            shipperName: sor.shipper_name,
          })
          : email.sendBookingPaidEmail({
            to: sor.carrier_email,
            carrierName: sor.carrier_name,
            routeTitle: cim,
            bookingId: sor.booking_id,
            priceHuf: fuvardij,
            shipperName: sor.shipper_name,
          })), fuvar ? 'job_paid' : 'booking_paid');
      }
      realtime.emitToUser(szallitoId, esemeny, payload);
    }

    // 2) A FELADÓ: díj-visszaigazolás tartós adathordozón (45/2014. 18. §) —
    //    a bizonylat összegével és könyvelt időpontjával.
    if (sor.shipper_email) {
      hatterben(() => email.sendFeeConfirmationEmail({
        to: sor.shipper_email,
        shipperName: sor.shipper_name,
        jobTitle: cim,
        feeHuf: Number(sor.fee_huf),
        cashHuf: fuvardij,
        paidAtIso,
        detailsPath: fuvar ? `/dashboard/fuvar/${sor.job_id}` : '/dashboard/foglalasaim',
      }), 'fee_confirmation');
    }
    if (feladoId) realtime.emitToUser(feladoId, esemeny, payload);
  } catch (err) {
    riaszt('[fee-notify] a díjfizetés utáni értesítés kiküldése közben hiba', err);
  }
  return { kuldve: true };
}

module.exports = { dijFizetesUtaniErtesitesek };
