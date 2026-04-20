// Élő követés: a sofőr periódikusan POST-olja a pozícióját.
// Közelség-alapú push: ha a sofőr beér a célvárosba (~5 km) vagy
// egy saroknyira van (~300 m), a feladó push értesítést kap.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const realtime = require('../realtime');
const { distanceMeters } = require('../utils/geo');
const { createNotification } = require('../services/notifications');

const router = express.Router();

const CITY_THRESHOLD_M = 5000;   // 5 km = "beért a városba"
const NEARBY_THRESHOLD_M = 300;  // 300 m = "egy saroknyira van"

// POST /jobs/:jobId/location – a fuvar kijelölt sofőre küld GPS pinget
router.post('/jobs/:jobId/location', authRequired, async (req, res) => {
  const { jobId } = req.params;
  const { lat, lng, speed_kmh } = req.body || {};
  if (lat == null || lng == null) return res.status(400).json({ error: 'Hiányzó koordináta' });

  const { rows: jobRows } = await db.query(
    `SELECT carrier_id, shipper_id, status, dropoff_lat, dropoff_lng, dropoff_address,
            notif_city_sent, notif_nearby_sent, title,
            recipient_name, recipient_phone, recipient_email,
            tracking_token, delivery_code
       FROM jobs WHERE id = $1`,
    [jobId],
  );
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });
  if (job.carrier_id !== req.user.sub) return res.status(403).json({ error: 'Nincs jogosultság' });

  await db.query(
    `INSERT INTO location_pings (job_id, carrier_id, lat, lng, speed_kmh)
     VALUES ($1,$2,$3,$4,$5)`,
    [jobId, req.user.sub, lat, lng, speed_kmh || null],
  );

  // Utolsó ismert pozíció frissítése a useren (backhaul + instant push-hoz)
  db.query(
    `UPDATE users SET last_known_lat = $1, last_known_lng = $2, last_ping_at = NOW() WHERE id = $3`,
    [lat, lng, req.user.sub],
  ).catch(() => {});

  const ping = { job_id: jobId, lat, lng, speed_kmh: speed_kmh || null, ts: Date.now() };
  realtime.emitToJob(jobId, 'tracking:ping', ping);
  res.json({ ok: true });

  // --- Közelség-alapú push értesítések (fire-and-forget) ---
  if (job.status === 'in_progress' && job.dropoff_lat && job.dropoff_lng) {
    setImmediate(async () => {
      try {
        const dist = distanceMeters(lat, lng, job.dropoff_lat, job.dropoff_lng);

        // 1) Beért a célvárosba (~5 km)
        if (!job.notif_city_sent && dist <= CITY_THRESHOLD_M) {
          await db.query(
            `UPDATE jobs SET notif_city_sent = TRUE WHERE id = $1 AND notif_city_sent = FALSE`,
            [jobId],
          );
          const cityName = extractCity(job.dropoff_address);
          await createNotification({
            user_id: job.shipper_id,
            type: 'driver_entering_city',
            title: '🏙️ A sofőr megérkezett!',
            body: `A sofőr beért ${cityName ? cityName + ' városba' : 'a célvárosba'} — hamarosan nálad a csomag!`,
            link: `/dashboard/fuvar/${jobId}`,
          });
          realtime.emitToUser(job.shipper_id, 'tracking:city-entered', {
            job_id: jobId, distance_m: Math.round(dist),
          });
          // Címzett SMS/email — "hamarosan megérkezik"
          if (job.recipient_phone || job.recipient_email) {
            const baseUrl = process.env.PUBLIC_URL || 'https://gofuvar.hu';
            const trackUrl = `${baseUrl}/nyomon-kovetes/${job.tracking_token}`;
            if (job.recipient_phone) {
              console.log(`[proximity-sms] VÁROS: ${job.recipient_phone} → Hamarosan megérkezik a csomagod! Kövesd: ${trackUrl}`);
            }
            if (job.recipient_email) {
              const { sendEmail } = require('../services/email');
              sendEmail({
                to: job.recipient_email,
                subject: '🏙️ A sofőr hamarosan megérkezik a csomagoddal!',
                html: `<p>Szia${job.recipient_name ? ` ${job.recipient_name}` : ''}!</p><p>A sofőr beért a városba, hamarosan nálad a csomag.</p><p><a href="${trackUrl}">📍 Kövesd élőben itt</a></p><p>Átvételi kód: <strong style="font-size:24px;letter-spacing:4px">${job.delivery_code}</strong></p>`,
              }).catch(() => {});
            }
          }
          console.log(`[proximity] job ${jobId}: sofőr beért a városba (${Math.round(dist)} m)`);
        }

        // 2) Egy saroknyira van (~300 m)
        if (!job.notif_nearby_sent && dist <= NEARBY_THRESHOLD_M) {
          await db.query(
            `UPDATE jobs SET notif_nearby_sent = TRUE WHERE id = $1 AND notif_nearby_sent = FALSE`,
            [jobId],
          );
          await createNotification({
            user_id: job.shipper_id,
            type: 'driver_nearby',
            title: '📍 A sofőr egy saroknyira van!',
            body: `Készítsd elő az átvételi kódot — a sofőr mindjárt megérkezik a csomagoddal!`,
            link: `/dashboard/fuvar/${jobId}`,
          });
          realtime.emitToUser(job.shipper_id, 'tracking:nearby', {
            job_id: jobId, distance_m: Math.round(dist),
          });
          // Címzett SMS/email — "egy saroknyira van + kód"
          if (job.recipient_phone || job.recipient_email) {
            if (job.recipient_phone) {
              console.log(`[proximity-sms] SAROK: ${job.recipient_phone} → A sofőr egy saroknyira van! Átvételi kód: ${job.delivery_code}`);
            }
            if (job.recipient_email) {
              const { sendEmail } = require('../services/email');
              sendEmail({
                to: job.recipient_email,
                subject: '📍 A sofőr egy saroknyira van!',
                html: `<p>Szia${job.recipient_name ? ` ${job.recipient_name}` : ''}!</p><p><strong>A sofőr mindjárt megérkezik!</strong> Készítsd elő az átvételi kódot:</p><div style="text-align:center;font-size:40px;font-weight:800;letter-spacing:8px;font-family:monospace;padding:16px;background:#f0fdf4;border-radius:12px;margin:16px 0">${job.delivery_code}</div><p>Ezt a kódot mondd meg a sofőrnek, vagy mutasd meg a QR kódot a tracking oldalon.</p>`,
              }).catch(() => {});
            }
          }
          console.log(`[proximity] job ${jobId}: sofőr egy saroknyira (${Math.round(dist)} m)`);
        }
      } catch (err) {
        console.warn('[proximity] push hiba:', err.message);
      }
    });
  }
});

// Város neve kinyerése a címből (utolsó vessző előtti rész vagy első szó)
function extractCity(address) {
  if (!address) return null;
  const parts = address.split(',').map((s) => s.trim());
  // Magyar cím: általában "Utca, Város" vagy "Város, Ország"
  if (parts.length >= 2) return parts[parts.length - 2] || parts[0];
  return parts[0];
}

// GET /jobs/:jobId/location/last – legutolsó pozíció
router.get('/jobs/:jobId/location/last', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT lat, lng, speed_kmh, recorded_at
       FROM location_pings WHERE job_id = $1
      ORDER BY recorded_at DESC LIMIT 1`,
    [req.params.jobId],
  );
  res.json(rows[0] || null);
});

module.exports = router;
