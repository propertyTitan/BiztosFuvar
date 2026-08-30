// =====================================================================
//  SMS-újraküldési kör — a néma SMS-kiesés második védvonala (2026-08-30)
//
//  A sms.js a sikertelen, ÚJRAPRÓBÁLHATÓ küldést (SeeMe code=13/7,
//  hálózati hiba) a sms_retry_queue táblába teszi. Ez a kör 10 percenként
//  előveszi az esedékes sorokat és újraküldi őket — a hiba elhárítása után
//  (IP-tartomány visszaállítása / egyenleg-feltöltés) a bennragadt SMS-ek
//  tehát MAGUKTÓL kimennek, senkinek nem kell emlékeznie rájuk.
//
//  Korlátok:
//    - 48 óra után nincs több próba (a felvételi SMS addigra okafogyott);
//      a lejárt sort a napi retenció törli (retention.js:
//      purgeExpiredSmsRetryQueue) — Sentry-jelzéssel, mert az VÉGLEGES
//      kézbesítetlenség.
//    - két próba közt legalább 10 perc telik el (az elakadt gateway-t
//      nem érdemes percenként verni);
//    - a claim atomi (FOR UPDATE SKIP LOCKED + attempts-bump), tehát két
//      átfedő kör sem küldi el ugyanazt kétszer.
// =====================================================================

const db = require('../db');
const { sendSms } = require('./sms');

const QUEUE_MAX_AGE_HOURS = 48;
const RETRY_GAP_MINUTES = 10;
const BATCH_LIMIT = 50;

async function runSmsRetryQueue() {
  let sent = 0;
  try {
    // Atomi claim: az esedékes sorok kísérlet-számlálója a küldés ELŐTT nő
    // (a paymentReminders mintája) — átfedő futásnál a második kör a
    // SKIP LOCKED + a friss last_attempt_at miatt nem veszi elő ugyanazt.
    const { rows } = await db.query(
      `UPDATE sms_retry_queue q
          SET attempts = attempts + 1, last_attempt_at = NOW()
        WHERE q.id IN (
          SELECT id FROM sms_retry_queue
           WHERE created_at > NOW() - make_interval(hours => $1)
             AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - make_interval(mins => $2))
           ORDER BY created_at
           LIMIT $3
           FOR UPDATE SKIP LOCKED
        )
        RETURNING q.id, q.phone, q.message`,
      [QUEUE_MAX_AGE_HOURS, RETRY_GAP_MINUTES, BATCH_LIMIT],
    );

    for (const row of rows) {
      // queueOnFailure: false — a sikertelen újrapróba NEM duplikálhatja a
      // saját sorát (az itt lévő sor marad, a következő kör újra előveszi).
      const res = await sendSms(row.phone, row.message, { queueOnFailure: false });
      if (res.ok) {
        await db.query('DELETE FROM sms_retry_queue WHERE id = $1', [row.id]);
        sent += 1;
      } else {
        await db.query(
          'UPDATE sms_retry_queue SET last_error = $2 WHERE id = $1',
          [row.id, String(res.error || 'ismeretlen hiba').slice(0, 300)],
        );
      }
    }

    if (sent > 0) {
      console.log(`[sms-retry] ${sent} bennragadt SMS kézbesítve az újrapróbálkozáskor`);
    }
  } catch (err) {
    console.error('[sms-retry] kör hiba:', err.message);
    if (process.env.SENTRY_DSN) {
      try { require('@sentry/node').captureException(err); } catch (_) { /* no-op */ }
    }
  }
  return sent;
}

module.exports = {
  runSmsRetryQueue, QUEUE_MAX_AGE_HOURS, RETRY_GAP_MINUTES, BATCH_LIMIT,
};
