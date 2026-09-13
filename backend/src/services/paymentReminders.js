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
const { jelezSorHibak } = require('./utemezo');

// ⚠️ BEVEZETÉS-DÁTUM KÜSZÖB (2026-09-13, teljes audit D4). A lejáratás
// első éles futása (2026-09-11 18:37) a TÖRTÉNELMI adatokon cselekedett:
// két régi, elfogadott-fizetetlen fuvart zárt le egyszerre (köztük nagy
// eséllyel a Manus QA-fuvarját). SZABÁLY: idő-alapú kör CSAK a bevezetése
// után keletkezett sorokra hat — a régiekre tudatos, egyszeri döntés kell.
const LEJARATAS_BEVEZETVE = process.env.PAYMENT_EXPIRY_SINCE || '2026-09-11';

const FIRST_AFTER_HOURS = 24;
const SECOND_AFTER_HOURS = 48;
const MAX_REMINDERS = 2;
/** A 2. (utolsó) emlékeztető után ennyi órával a fizetetlen megállapodás lejár. */
const EXPIRE_AFTER_HOURS = Number(process.env.PAYMENT_EXPIRE_AFTER_HOURS) || 72;

/**
 * @returns {Promise<number>} az elküldött emlékeztetők száma
 */
async function runPaymentReminders() {
  let sent = 0;
  let korHiba = null;
  const sorHibak = [];
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
        sorHibak.push(err);
      }
    }
    if (sent > 0) console.log(`[payment-reminder] ${sent} fizetési emlékeztető elküldve`);
  } catch (err) {
    console.error('[payment-reminder] kör hiba:', err.message);
    korHiba = err;
  }
  try {
    await runPaymentExpiry();
  } catch (err) {
    console.error('[payment-expiry] kör hiba:', err.message);
    korHiba = korHiba || err;
  }
  // (D4, 2026-09-13) A bevétel-kritikus kör hibája eddig a console-ban halt
  // meg: a soronkénti hibák riasztást kapnak, a kör-szintű hiba továbbmegy
  // az ütemező burkolójához (Sentry).
  jelezSorHibak('payment-reminder', sorHibak);
  if (korHiba) throw korHiba;
  return sent;
}

// =====================================================================
//  FIZETETLEN MEGÁLLAPODÁS LEJÁRATÁSA (2026-09-11, teljes audit A4)
//
//  A két emlékeztető után a fuvar eddig ÖRÖKRE 'accepted' + fizetetlen
//  maradt: a szállító várt egy feladóra, aki nem fizet (és a szállítót
//  semmi nem szabadította fel), a piactérről a fuvar eltűnt, a feladó
//  semmit nem tudott a következményről. Az egyéves „elhagyott fuvar"
//  retenció zárta csak le. Most: az utolsó emlékeztető után
//  EXPIRE_AFTER_HOURS (alap 72 h — ~6 nap a megállapodástól) → a fuvar
//  LEZÁRUL ('cancelled', cancel_reason 'payment_expired'), a függő díj-sor
//  'refunded' (nem volt pénzmozgás), mindkét fél értesítést + e-mailt kap.
//  NEM újranyitás: egy hat napja nem reagáló feladó fuvarját nem érdemes
//  a piactéren tartani (zombi-hirdetés, ami újabb szállítókat fárasztana).
//  Ha mégis aktuális, a feladó egy kattintással újra feladja.
// =====================================================================
async function runPaymentExpiry() {
  let lezart = 0;
  const { rows } = await db.query(
    `SELECT j.id, j.title, j.shipper_id, j.carrier_id,
            s.email AS shipper_email, s.full_name AS shipper_name,
            c.email AS carrier_email, c.full_name AS carrier_name
       FROM jobs j
       JOIN users s ON s.id = j.shipper_id
  LEFT JOIN users c ON c.id = j.carrier_id
      WHERE j.status = 'accepted'
        AND j.paid_at IS NULL
        AND j.payment_reminder_count >= $1
        AND j.last_payment_reminder_at < NOW() - ($2 || ' hours')::interval
        AND j.created_at >= $3::date
      LIMIT 500`,
    [MAX_REMINDERS, EXPIRE_AFTER_HOURS, LEJARATAS_BEVEZETVE],
  );
  for (const j of rows) {
    try {
      // Feltételes: közben fizethettek / lemondhatták — akkor nem nyúlunk hozzá.
      const upd = await db.query(
        `UPDATE jobs
            SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = NULL,
                cancel_reason = 'payment_expired', cancellation_fee_huf = 0, refund_huf = 0,
                updated_at = NOW()
          WHERE id = $1 AND status = 'accepted' AND paid_at IS NULL`,
        [j.id],
      );
      if (upd.rowCount === 0) continue;
      await db.query(
        `UPDATE escrow_transactions SET status = 'refunded', refunded_at = NOW()
          WHERE job_id = $1 AND status = 'held'`,
        [j.id],
      );
      lezart += 1;
      const { sendEmail, wrapHtml, escapeHtml } = require('./email');
      await createNotification({
        user_id: j.shipper_id,
        type: 'payment_expired',
        title: '⌛ A megállapodás lejárt — a fuvart lezártuk',
        body: `A(z) "${j.title || 'fuvar'}" fuvaron megvolt a megállapodás, de a kapcsolatfelvételi díjat két emlékeztető után sem fizetted ki, ezért a fuvart lezártuk és a szállítót felszabadítottuk. Ha még aktuális, add fel újra.`,
        link: `/dashboard/fuvar/${j.id}`,
      });
      if (j.shipper_email) {
        await sendEmail({
          to: j.shipper_email,
          subject: '⌛ A megállapodás lejárt — a fuvart lezártuk',
          html: wrapHtml({
            heading: '⌛ Lejárt a fizetési határidő',
            bodyHtml: `<p>Szia${j.shipper_name ? ` ${escapeHtml(j.shipper_name)}` : ''}!</p>`
              + `<p>A(z) <strong>${escapeHtml(j.title || 'fuvar')}</strong> fuvaron megvolt a megállapodás a szállítóval, de a kapcsolatfelvételi díjat két emlékeztető után sem fizetted ki. `
              + 'A fuvart ezért lezártuk, és a szállítót felszabadítottuk — nem kell tovább várnia.</p>'
              + '<p>Ha a szállítás még aktuális, add fel újra a fuvart: a szállítók percek alatt tesznek rá ajánlatot.</p>',
            ctaText: 'Új fuvar feladása',
            ctaHref: `${process.env.PUBLIC_URL || 'https://www.gofuvar.hu'}/dashboard/uj-fuvar`,
          }),
        });
      }
      if (j.carrier_id) {
        await createNotification({
          user_id: j.carrier_id,
          type: 'payment_expired',
          title: 'A feladó nem fizette ki a díjat — a fuvar lezárult',
          body: `A(z) "${j.title || 'fuvar'}" fuvar feladója nem fizette ki a kapcsolatfelvételi díjat, ezért a fuvart lezártuk. Nem kell tovább várnod — nézd meg a többi elérhető fuvart!`,
          link: '/sofor/fuvarok',
        });
        if (j.carrier_email) {
          await sendEmail({
            to: j.carrier_email,
            subject: 'A fuvar lezárult — a feladó nem fizette ki a díjat',
            html: wrapHtml({
              heading: 'Nem kell tovább várnod',
              bodyHtml: `<p>Szia${j.carrier_name ? ` ${escapeHtml(j.carrier_name)}` : ''}!</p>`
                + `<p>A(z) <strong>${escapeHtml(j.title || 'fuvar')}</strong> fuvar feladója a megállapodás után sem fizette ki a kapcsolatfelvételi díjat, ezért a fuvart lezártuk. `
                + 'Az elérhető fuvarok között bármikor találsz újat.</p>',
              ctaText: 'Elérhető fuvarok',
              ctaHref: `${process.env.PUBLIC_URL || 'https://www.gofuvar.hu'}/sofor/fuvarok`,
            }),
          });
        }
      }
    } catch (err) {
      console.error(`[payment-expiry] fuvar ${j.id} hiba:`, err.message);
    }
  }
  if (lezart > 0) console.log(`[payment-expiry] ${lezart} fizetetlen megállapodás lezárva`);
  return lezart;
}

module.exports = {
  runPaymentReminders, runPaymentExpiry,
  FIRST_AFTER_HOURS, SECOND_AFTER_HOURS, MAX_REMINDERS, EXPIRE_AFTER_HOURS,
};
