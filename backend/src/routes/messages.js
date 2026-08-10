// In-app üzenetváltás feladó ↔ szállító között.
//
// A "beszélgetés" egy fuvarhoz (job_id) vagy foglaláshoz (booking_id)
// kötődik. Mindkét érintett fél küldhet és olvashat üzeneteket. A
// backend a beérkező üzenetet Socket.IO-n is kiszórja, így a chat
// valós idejű.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { requireText } = require('../utils/text');
const { detectContactLeak } = require('../utils/contactGuard');
const realtime = require('../realtime');
const { writeRateLimit } = require('../middleware/rateLimit');
const { createNotification } = require('../services/notifications');

const router = express.Router();

/**
 * Jogosultság-ellenőrzés: a user érintett fél-e az adott
 * job-ban vagy booking-ban.
 */
async function checkAccess(req, jobId, bookingId) {
  if (jobId) {
    const { rows } = await db.query(
      'SELECT shipper_id, carrier_id, paid_at FROM jobs WHERE id = $1',
      [jobId],
    );
    const j = rows[0];
    if (!j) return null;
    if (j.shipper_id !== req.user.sub && j.carrier_id !== req.user.sub) return null;
    return {
      jobId, bookingId: null, paidAt: j.paid_at,
      otherUserId: j.shipper_id === req.user.sub ? j.carrier_id : j.shipper_id,
      felek: [j.shipper_id, j.carrier_id].filter(Boolean),
    };
  }
  if (bookingId) {
    const { rows } = await db.query(
      `SELECT b.shipper_id, b.paid_at, r.carrier_id
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE b.id = $1`,
      [bookingId],
    );
    const b = rows[0];
    if (!b) return null;
    if (b.shipper_id !== req.user.sub && b.carrier_id !== req.user.sub) return null;
    return {
      jobId: null, bookingId, paidAt: b.paid_at,
      otherUserId: b.shipper_id === req.user.sub ? b.carrier_id : b.shipper_id,
      felek: [b.shipper_id, b.carrier_id].filter(Boolean),
    };
  }
  return null;
}

// POST /messages – üzenet küldése
router.post('/messages', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, body } = req.body || {};
  const bodyCheck = requireText(body, { label: 'Az üzenet', min: 1, max: 5000 });
  if (!bodyCheck.ok) {
    return res.status(400).json({ error: 'Üres üzenet' });
  }
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg job_id-t vagy booking_id-t.' });
  }

  const access = await checkAccess(req, job_id, booking_id);
  if (!access) {
    return res.status(403).json({ error: 'Nincs jogosultságod üzenetet küldeni ezen a fuvaron.' });
  }

  // ── KAPCSOLAT-SZIVÁRGÁS SZŰRŐ (anti-bypass) ──
  // A platform EGYETLEN bevétele a kapcsolatfelvételi díj, és a felek
  // pontosan úgy kerülnék meg, hogy itt, a chatben küldik el egymásnak a
  // telefonszámukat, majd platformon kívül intézik a fuvart.
  //
  // ⚠️ 2026-08-07: ez az üzleti szabály a CLAUDE.md-ben rögzítve volt, a
  // jobs.js kommentje is ÁLLÍTOTTA, hogy „a chatben a contactGuard szűri a
  // számokat" — de a chatben SOHA nem volt megírva; csak a kérdés-válasz
  // felületen. A mutációs tesztelés bukkant rá (a contactGuard 10%-os
  // pontszáma vezetett ide).
  //
  // CSAK a díj kifizetése ELŐTT szűrünk: utána a felek jogosan ismerik
  // egymás elérhetőségét, ott a szűrés csak zavarna.
  if (!access.paidAt) {
    const leak = detectContactLeak(bodyCheck.value);
    if (leak) return res.status(400).json({ error: leak, code: 'CONTACT_LEAK' });
  }

  const { rows } = await db.query(
    // A CÍMZETTET is rögzítjük (067-es migráció): egy beszélgetés mindig KÉT
    // fél között zajlik, és enélkül a szállító-csere után nem lehet pontosan
    // eldönteni, ki volt részese egy üzenetnek.
    `INSERT INTO messages (job_id, booking_id, sender_id, recipient_id, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [access.jobId, access.bookingId, req.user.sub, access.otherUserId, bodyCheck.value],
  );
  const msg = rows[0];

  // Küldő neve
  const { rows: senderRows } = await db.query(
    'SELECT full_name FROM users WHERE id = $1',
    [req.user.sub],
  );
  const senderName = senderRows[0]?.full_name || 'Valaki';

  // Socket.IO: CSAK a két félnek, a személyes szobájukba. (Korábban
  // emitGlobal ment minden csatlakozott kliensnek — bárki lehallgathatta
  // a platform összes privát üzenetét.)
  const chatEvent = job_id ? `chat:job:${job_id}` : `chat:booking:${booking_id}`;
  const chatPayload = { ...msg, sender_name: senderName };
  realtime.emitToUser(req.user.sub, chatEvent, chatPayload);
  if (access.otherUserId && access.otherUserId !== req.user.sub) {
    realtime.emitToUser(access.otherUserId, chatEvent, chatPayload);
  }

  // Értesítés a másik félnek (ha van)
  // A link a CÍMZETT szemszögéből kell legyen: ha ő a szállító, a szállítói
  // fuvar nézetre (/sofor/fuvar/...), ha feladó, a feladói nézetre
  // (/dashboard/fuvar/...). Így a mobil route mapping is a megfelelő
  // képernyőre viszi (ahol van chat + lezárás gomb).
  if (access.otherUserId) {
    let notifLink = '/ertesitesek';
    if (job_id) {
      const { rows: jobRows } = await db.query(
        'SELECT shipper_id FROM jobs WHERE id = $1',
        [job_id],
      );
      // Ha a másik fél a feladó → feladói nézet; ha szállító → szállítói nézet
      const otherIsShipper = jobRows[0]?.shipper_id === access.otherUserId;
      notifLink = otherIsShipper
        ? `/dashboard/fuvar/${job_id}`
        : `/sofor/fuvar/${job_id}`;
    }
    if (booking_id) {
      notifLink = `/dashboard/foglalasaim`;
    }
    try {
      await createNotification({
        user_id: access.otherUserId,
        type: 'chat_message',
        title: `💬 Új üzenet – ${senderName}`,
        body: bodyCheck.value.slice(0, 100),
        link: notifLink,
      });
    } catch {}
  }

  res.status(201).json({ ...msg, sender_name: senderName });
});

// GET /messages?job_id=... vagy ?booking_id=...
router.get('/messages', authRequired, async (req, res) => {
  const { job_id, booking_id } = req.query;
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg job_id-t vagy booking_id-t.' });
  }

  const access = await checkAccess(req, job_id || null, booking_id || null);
  if (!access) {
    return res.status(403).json({ error: 'Nincs jogosultság.' });
  }

  const col = job_id ? 'job_id' : 'booking_id';
  const val = job_id || booking_id;
  // ⚠️ CSAK AZ A BESZÉLGETÉS, AMINEK A HÍVÓ RÉSZESE VOLT (2026-08-10).
  //
  // Az első javítás a JELENLEGI felekre szűrt — az elrejtette a leváltott
  // szállító üzeneteit, de a FELADÓ üzeneteit NEM, holott azokat a feladó a
  // KORÁBBI szállítónak írta („a kapukód 1234"). A tesztje is csak a szállító
  // üzenetét vizsgálta, ezért zöld lett a fél védelem mellett.
  //
  // A gyökér-ok az volt, hogy a sorból nem derült ki, KINEK szólt az üzenet.
  // A 067-es migráció óta rögzítjük a címzettet, így a szűrés pontos:
  // a felhasználó azt látja, aminek küldőként vagy címzettként részese volt.
  const { rows } = await db.query(
    `SELECT m.*, u.full_name AS sender_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.${col} = $1
        AND (m.sender_id = $2 OR m.recipient_id = $2)
      ORDER BY m.created_at ASC
      LIMIT 500`,
    [val, req.user.sub],
  );

  res.json(rows);
});

module.exports = router;
