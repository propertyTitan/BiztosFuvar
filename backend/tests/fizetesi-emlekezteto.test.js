// =====================================================================
//  Fizetetlen-fuvar emlékeztető (2026-08-09) — a fizetési visszahozó háló.
//
//  A megállapodás (accepted) után, a díjfizetés ELŐTT a feladó jellemzően
//  nincs az oldalon; a napi emlékeztető-kör hozza vissza. A platform
//  bevétele ezen a lépcsőn múlik, ezért a célzásnak PONTOSNAK kell lennie:
//  csak accepted + fizetetlen fuvart, csak esedékeset (24h/48h), max 2×.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';

const { db, createUser, createJob } = require('./helpers');
const { runPaymentReminders } = require('../src/services/paymentReminders');

// Egy accepted+fizetetlen fuvar, adott "megállapodás óta eltelt" korral.
async function acceptedJob({ shipperId, carrierId, agoHours, reminderCount = 0, lastReminderAgoHours = null, paid = false, status = 'accepted' }) {
  const job = await createJob({ shipperId, carrierId, status, paid });
  await db.query(
    `UPDATE jobs SET updated_at = NOW() - ($2 || ' hours')::interval,
                     payment_reminder_count = $3,
                     last_payment_reminder_at = ${lastReminderAgoHours == null ? 'NULL' : `NOW() - ($4 || ' hours')::interval`}
      WHERE id = $1`,
    lastReminderAgoHours == null ? [job.id, agoHours, reminderCount] : [job.id, agoHours, reminderCount, lastReminderAgoHours],
  );
  return job;
}

async function reminderCount(jobId) {
  const { rows } = await db.query('SELECT payment_reminder_count FROM jobs WHERE id = $1', [jobId]);
  return rows[0]?.payment_reminder_count;
}
async function notifCount(userId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND type = 'payment_reminder'`,
    [userId],
  );
  return rows[0].n;
}

describe('Fizetetlen-fuvar emlékeztető célzása', () => {
  it('a 24h-nál régebbi, még nem emlékeztetett fuvar KAP emlékeztetőt', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await acceptedJob({ shipperId: felado.id, carrierId: szallito.id, agoHours: 25 });

    await runPaymentReminders();

    expect(await reminderCount(job.id)).toBe(1);
    expect(await notifCount(felado.id)).toBe(1);
  });

  it('a FRISS (24h-nál újabb) megállapodás NEM kap emlékeztetőt', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await acceptedJob({ shipperId: felado.id, carrierId: szallito.id, agoHours: 2 });

    await runPaymentReminders();

    expect(await reminderCount(job.id)).toBe(0);
    expect(await notifCount(felado.id)).toBe(0);
  });

  it('a MÁR FIZETETT fuvar SOHA nem kap emlékeztetőt', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await acceptedJob({ shipperId: felado.id, carrierId: szallito.id, agoHours: 100, paid: true, status: 'in_progress' });

    await runPaymentReminders();

    expect(await notifCount(felado.id)).toBe(0);
    expect(await reminderCount(job.id)).toBe(0);
  });

  it('a lezárt (delivered) fuvar nem kap emlékeztetőt', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await acceptedJob({ shipperId: felado.id, carrierId: szallito.id, agoHours: 100, status: 'delivered', paid: true });
    await runPaymentReminders();
    expect(await notifCount(felado.id)).toBe(0);
  });

  it('a 2. emlékeztető csak 48h-val az 1. után megy (és ott megáll — max 2)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    // Már kapott 1 emlékeztetőt, az 50 órája volt → esedékes a 2.
    const job = await acceptedJob({
      shipperId: felado.id, carrierId: szallito.id,
      agoHours: 100, reminderCount: 1, lastReminderAgoHours: 50,
    });

    await runPaymentReminders();
    expect(await reminderCount(job.id)).toBe(2);

    // A 3. már NEM megy — a max elérve (a count sem nő tovább)
    await db.query(`UPDATE jobs SET last_payment_reminder_at = NOW() - INTERVAL '100 hours' WHERE id = $1`, [job.id]);
    await runPaymentReminders();
    expect(await reminderCount(job.id)).toBe(2);
  });

  it('az 1. emlékeztető UTÁN a 2. még NEM megy, ha csak pár óra telt el', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await acceptedJob({
      shipperId: felado.id, carrierId: szallito.id,
      agoHours: 100, reminderCount: 1, lastReminderAgoHours: 5,
    });
    await runPaymentReminders();
    expect(await reminderCount(job.id)).toBe(1); // nem nőtt: még nincs 48h
  });
});
