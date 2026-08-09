// =====================================================================
//  Fizetetlen-fuvar emlékeztető (2026-08-09, több-ügynökös átvizsgálás)
//
//  A megállapodás (accepted) után, de a kapcsolatfelvételi díj kifizetése
//  ELŐTT a feladó (a fizető) jellemzően nincs az oldalon, és semmi nem
//  hívja vissza — a platform bevétele itt akad el a leggyakrabban. Ez a
//  napi kör az accepted + paid_at IS NULL fuvarokra küld emlékeztetőt
//  (email + in-app):
//    - 1. emlékeztető: a megállapodás (updated_at) után ~24 órával
//    - 2. emlékeztető: az 1. után ~48 órával (utolsó, sürgetőbb hangnem)
//  Max 2 emlékeztető fuvaronként. Soha nem dob (a scheduler üres catch-e
//  mögött fut, de a belső hibát is elnyeli, hogy egy rossz sor ne állítsa
//  meg a többit).
// =====================================================================

const db = require('../db');
const { createNotification } = require('./notifications');
const { sendPaymentDueEmail } = require('./email');
const { calculateConnectionFee } = require('./connectionFee');

const FIRST_AFTER_HOURS = 24;
const SECOND_AFTER_HOURS = 48;
const MAX_REMINDERS = 2;

/**
 * @returns {Promise<number>} az elküldött emlékeztetők száma
 */
async function runPaymentReminders() {
  let sent = 0;
  try {
    // Esedékes fuvarok: accepted + fizetetlen, és vagy még nem kaptak
    // emlékeztetőt (updated_at = a megállapodás proxyja, accepted+fizetetlen
    // állapotban nincs utána más művelet), vagy az előző emlékeztető óta
    // eltelt a köztes idő. Max MAX_REMINDERS.
    const { rows } = await db.query(
      `SELECT j.id, j.title, j.shipper_id, j.accepted_price_huf, j.connection_fee_huf,
              j.payment_reminder_count,
              s.email AS shipper_email, s.full_name AS shipper_name
         FROM jobs j
         JOIN users s ON s.id = j.shipper_id
        WHERE j.status = 'accepted'
          AND j.paid_at IS NULL
          AND j.payment_reminder_count < $1
          AND (
            (j.payment_reminder_count = 0
              AND j.updated_at < NOW() - ($2 || ' hours')::interval)
            OR
            (j.payment_reminder_count = 1
              AND j.last_payment_reminder_at < NOW() - ($3 || ' hours')::interval)
          )
        LIMIT 500`,
      [MAX_REMINDERS, FIRST_AFTER_HOURS, SECOND_AFTER_HOURS],
    );

    for (const j of rows) {
      const reminderNo = (j.payment_reminder_count || 0) + 1;
      try {
        // ── ATOMI CLAIM a küldés ELŐTT (2026-08-09, audit 3. kör) ──
        // A számláló korábban a küldés UTÁN nőtt, a fenti SELECT alapján.
        // Két egyidejű kör (Railway újraindítás/deploy-átfedés, vagy két
        // példány) ugyanazt a sort kiolvasta, és a feladó KÉT azonos
        // emlékeztetőt kapott — a fizetés-sürgetés spammé válik, épp a
        // legérzékenyebb ponton. A feltételes UPDATE-et csak egy kör nyeri
        // meg (`payment_reminder_count` = amit láttunk), a másik kihagyja.
        // A `paid_at IS NULL` újraellenőrzése a közben megtörtént fizetés
        // esetét is zárja.
        const claim = await db.query(
          `UPDATE jobs
              SET payment_reminder_count = $1, last_payment_reminder_at = NOW()
            WHERE id = $2
              AND payment_reminder_count = $3
              AND paid_at IS NULL
              AND status = 'accepted'
            RETURNING id`,
          [reminderNo, j.id, j.payment_reminder_count || 0],
        );
        if (claim.rowCount === 0) continue;

        await createNotification({
          user_id: j.shipper_id,
          type: 'payment_reminder',
          title: reminderNo >= 2 ? '⏰ Utolsó emlékeztető: fizetésre vár a fuvarod' : '⏰ A fuvarod fizetésre vár',
          body: `A(z) "${j.title || 'fuvar'}" fuvarodon megvan a megállapodás, de a kapcsolatfelvételi díj még nincs kifizetve — fizesd meg a folytatáshoz.`,
          link: `/dashboard/fuvar/${j.id}`,
        });
        if (j.shipper_email) {
          await sendPaymentDueEmail({
            to: j.shipper_email,
            shipperName: j.shipper_name,
            jobTitle: j.title,
            jobId: j.id,
            agreedPriceHuf: j.accepted_price_huf,
            feeHuf: j.connection_fee_huf || calculateConnectionFee(j.accepted_price_huf),
            reminderNo,
          });
        }
        sent += 1;
      } catch (err) {
        // A számláló már megnőtt (claim), ezért egy megszakadt email-küldés
        // „elhasznál" egy emlékeztetőt. Ez a tudatos csere: egy kimaradt
        // emlékeztető olcsóbb, mint egy duplán kiküldött. A hiba a logban
        // (és a fuvar a következő körben már a következő fokozatot kapja).
        console.error(`[payment-reminder] fuvar ${j.id} hiba (az emlékeztető elhasználva):`, err.message);
      }
    }
    if (sent > 0) console.log(`[payment-reminder] ${sent} fizetési emlékeztető elküldve`);
  } catch (err) {
    console.error('[payment-reminder] kör hiba:', err.message);
  }
  return sent;
}

module.exports = { runPaymentReminders, FIRST_AFTER_HOURS, SECOND_AFTER_HOURS, MAX_REMINDERS };
