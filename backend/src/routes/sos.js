// =====================================================================
//  SOS vészhelyzet végpontok.
//
//  Bármelyik fél (feladó vagy szállító) egy gombnyomással jelezhet
//  vészhelyzetet. A rendszer logolja a GPS pozíciót, értesíti az
//  admint, és opcionálisan a fuvar másik résztvevőjét is.
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');
const { createNotification } = require('../services/notifications');
const { detectContactLeak } = require('../utils/contactGuard');
const realtime = require('../realtime');

const router = express.Router();

// POST /sos — vészjelzés küldése
router.post('/sos', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, lat, lng, message } = req.body || {};

  // ── (1) ÉRINTETTSÉG (2026-08-09, audit): a hívónak FELE kell legyen a
  // hivatkozott ügyletnek. Eddig bárki küldhetett „vészjelzést" TETSZŐLEGES
  // idegen fuvar azonosítójával — a fuvar feladója pedig megkapta a támadó
  // szövegét „🚨 A partnered segítséget kér!" címmel (in-app + push), és
  // minden admin egy hamis riasztást. Percenként 30 ilyen fért bele: a valódi
  // vészjelzések elvesztek volna a zajban.
  if (job_id) {
    const { rows: j } = await db.query(
      'SELECT 1 FROM jobs WHERE id = $1 AND (shipper_id = $2 OR carrier_id = $2)',
      [job_id, req.user.sub],
    );
    if (!j.length) return res.status(403).json({ error: 'Nincs jogosultságod ehhez a fuvarhoz.' });
  }
  if (booking_id) {
    const { rows: b } = await db.query(
      `SELECT 1 FROM route_bookings rb
         JOIN carrier_routes r ON r.id = rb.route_id
        WHERE rb.id = $1 AND (rb.shipper_id = $2 OR r.carrier_id = $2)`,
      [booking_id, req.user.sub],
    );
    if (!b.length) return res.status(403).json({ error: 'Nincs jogosultságod ehhez a foglaláshoz.' });
  }

  // ── (2) KAPCSOLAT-SZIVÁRGÁS: az SOS-üzenet a MÁSIK FÉLHEZ jut el, és eddig
  // kimaradt a szűrésből (a 10 szűrt csatorna közül ez a 11.). Fizetés előtt
  // egy „Hívj: 06 30…" szövegű ál-vészjelzéssel a díj megkerülhető volt.
  const leak = detectContactLeak(message);
  if (leak) return res.status(400).json({ error: leak, code: 'CONTACT_LEAK' });

  const { rows } = await db.query(
    `INSERT INTO sos_events (user_id, job_id, booking_id, lat, lng, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      req.user.sub,
      job_id || null,
      booking_id || null,
      lat || null,
      lng || null,
      message || null,
    ],
  );
  const sos = rows[0];

  // Admin értesítés
  try {
    const { rows: admins } = await db.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 10`,
    );
    const { rows: userInfo } = await db.query(
      `SELECT full_name, phone FROM users WHERE id = $1`,
      [req.user.sub],
    );
    // ⚠️ PII-MINIMALIZÁLÁS (2026-08-09, adatvédelmi audit): az értesítés
    // `body`-ja eddig a TELJES NEVET, a TELJES TELEFONSZÁMOT és az 5 tizedes
    // (≈1 m pontosságú) GPS-koordinátát tartalmazta — a `notifications`
    // táblában, ahol addig semmilyen retenció nem volt. Vagyis egy vészhelyzet
    // pontos helye és a bejelentő elérhetősége határidő nélkül megmaradt
    // minden admin értesítés-listájában. A jogosult admin ezeket az
    // admin-felületen látja; az értesítés csak a TÉNYT viszi.
    // (Ugyanez a minta, amit a KYC-értesítéseknél már alkalmaztunk.)
    const keresztnev = String(userInfo[0]?.full_name || '').trim().split(/\s+/)[0] || 'Egy felhasználó';

    for (const admin of admins) {
      await createNotification({
        user_id: admin.id,
        type: 'sos_alert',
        title: '🚨 SOS VÉSZJELZÉS!',
        body: `${keresztnev} segítséget kér. A részletek (elérhetőség, pozíció, üzenet) az admin-felületen.`,
        link: `/admin`,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[sos] admin notify hiba:', e.message);
  }

  // Ha van fuvar, értesítsük a másik felet is
  if (job_id) {
    try {
      const { rows: jobRows } = await db.query(
        `SELECT shipper_id, carrier_id, title FROM jobs WHERE id = $1`,
        [job_id],
      );
      const job = jobRows[0];
      if (job) {
        const otherId = job.shipper_id === req.user.sub ? job.carrier_id : job.shipper_id;
        if (otherId) {
          await createNotification({
            user_id: otherId,
            type: 'sos_partner_alert',
            title: '🚨 A partnered segítséget kér!',
            body: `A(z) "${job.title}" fuvarhoz kapcsolódó partnered vészjelzést küldött.${message ? ` Üzenet: "${message}"` : ''}`,
            link: job.shipper_id === req.user.sub
              ? `/sofor/fuvar/${job_id}`
              : `/dashboard/fuvar/${job_id}`,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[sos] partner notify hiba:', e.message);
    }
  }

  // Hitelesített feed (2026-08-09): egy vészjelzés ténye + a jelző user
  // azonosítója nem való be nem jelentkezett vendég-sockethez.
  realtime.emitToFeed('sos:new', {
    sos_id: sos.id,
    user_id: req.user.sub,
    job_id: job_id || null,
    created_at: sos.created_at,
  });

  res.status(201).json({ ok: true, sos_id: sos.id });
});

// GET /sos/mine — saját SOS események
router.get('/sos/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM sos_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.user.sub],
  );
  res.json(rows);
});

module.exports = router;
