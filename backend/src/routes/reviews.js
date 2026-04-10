// Kétirányú értékelés (Uber-szerű) — licites fuvarokra ÉS fix áras
// foglalásokra is. A fuvar lezárása (delivered/completed) után mindkét
// fél értékelheti a másikat 1-5 csillaggal + szöveges megjegyzéssel.
const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const { writeRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

/** Újraszámolja a reviewee rating_avg/rating_count-ját a reviews-ból. */
async function recalcRating(userId) {
  await db.query(
    `UPDATE users
        SET rating_avg   = COALESCE((SELECT ROUND(AVG(stars)::numeric, 1) FROM reviews WHERE reviewee_id = $1), 0),
            rating_count = (SELECT COUNT(*) FROM reviews WHERE reviewee_id = $1)
      WHERE id = $1`,
    [userId],
  );
}

// POST /reviews — értékelés beküldése (licites job VAGY fix áras booking)
router.post('/reviews', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, stars, comment } = req.body || {};

  if (!stars || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Adj meg 1 és 5 közötti csillagot.' });
  }
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg egy fuvar (job_id) vagy foglalás (booking_id) azonosítót.' });
  }

  let revieweeId = null;
  let entityTitle = '';

  if (job_id) {
    const { rows } = await db.query(
      'SELECT shipper_id, carrier_id, title, status FROM jobs WHERE id = $1',
      [job_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
    const j = rows[0];
    if (!['delivered', 'completed'].includes(j.status)) {
      return res.status(409).json({ error: 'Értékelni csak lezárt (delivered/completed) fuvart lehet.' });
    }
    if (j.shipper_id !== req.user.sub && j.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Csak az érintett felek értékelhetnek.' });
    }
    revieweeId = j.shipper_id === req.user.sub ? j.carrier_id : j.shipper_id;
    entityTitle = j.title;
  }

  if (booking_id) {
    const { rows } = await db.query(
      `SELECT b.shipper_id, r.carrier_id, r.title, b.status
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE b.id = $1`,
      [booking_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Foglalás nem található' });
    const b = rows[0];
    if (!['delivered', 'completed'].includes(b.status)) {
      return res.status(409).json({ error: 'Értékelni csak lezárt (delivered/completed) foglalást lehet.' });
    }
    if (b.shipper_id !== req.user.sub && b.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Csak az érintett felek értékelhetnek.' });
    }
    revieweeId = b.shipper_id === req.user.sub ? b.carrier_id : b.shipper_id;
    entityTitle = b.title;
  }

  if (!revieweeId) {
    return res.status(400).json({ error: 'Nem sikerült meghatározni kit értékelsz.' });
  }

  try {
    const { rows: inserted } = await db.query(
      `INSERT INTO reviews (job_id, booking_id, reviewer_id, reviewee_id, stars, comment)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [job_id || null, booking_id || null, req.user.sub, revieweeId, stars, comment || null],
    );
    const review = inserted[0];

    // Rating újraszámolás
    await recalcRating(revieweeId);

    // Értesítés a reviewee-nek
    try {
      const { rows: reviewerRows } = await db.query(
        'SELECT full_name FROM users WHERE id = $1',
        [req.user.sub],
      );
      const starEmoji = '⭐'.repeat(Math.min(stars, 5));
      await createNotification({
        user_id: revieweeId,
        type: 'review_received',
        title: `${starEmoji} Új értékelés!`,
        body: `${reviewerRows[0]?.full_name || 'Valaki'} ${stars} csillagot adott neked${entityTitle ? ` a(z) "${entityTitle}" fuvarért` : ''}.${comment ? ` „${comment.slice(0, 80)}"` : ''}`,
        link: `/ertesitesek`,
      });
    } catch (e) {
      console.warn('[notifications] review_received hiba:', e.message);
    }

    res.status(201).json(review);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Már értékelted ezt a fuvart / foglalást.' });
    }
    throw err;
  }
});

// GET /reviews?job_id=X | ?booking_id=X | ?user_id=X
// Bárki lekérheti — az értékelések publikusak.
router.get('/reviews', authRequired, async (req, res) => {
  const { job_id, booking_id, user_id } = req.query;
  let sql = `SELECT r.*, u.full_name AS reviewer_name
               FROM reviews r
               JOIN users u ON u.id = r.reviewer_id`;
  const params = [];
  if (job_id) {
    params.push(job_id);
    sql += ` WHERE r.job_id = $${params.length}`;
  } else if (booking_id) {
    params.push(booking_id);
    sql += ` WHERE r.booking_id = $${params.length}`;
  } else if (user_id) {
    params.push(user_id);
    sql += ` WHERE r.reviewee_id = $${params.length}`;
  } else {
    params.push(req.user.sub);
    sql += ` WHERE r.reviewee_id = $${params.length}`;
  }
  sql += ' ORDER BY r.created_at DESC LIMIT 100';
  const { rows } = await db.query(sql, params);
  res.json(rows);
});

// Kompatibilitás: a régi POST /jobs/:jobId/reviews endpoint is marad,
// de belsőleg a fenti logikára map-pel.
router.post('/jobs/:jobId/reviews', authRequired, writeRateLimit, async (req, res) => {
  req.body = { ...req.body, job_id: req.params.jobId, stars: req.body?.rating || req.body?.stars };
  // Továbbítjuk a fő handler-nek (a req/res szimulálásával nem érdemes
  // bonyolítani — egyszerűen duplikáljuk a logikát). Ehelyett a kliens
  // mostantól a POST /reviews-t hívja, ez csak visszafelé kompatibilitás.
  const { job_id, stars, comment } = req.body;
  if (!stars || stars < 1 || stars > 5) {
    return res.status(400).json({ error: '1-5 közötti pontszám' });
  }
  const { rows: jobRows } = await db.query(
    'SELECT shipper_id, carrier_id, title, status FROM jobs WHERE id = $1',
    [job_id],
  );
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });
  if (![job.shipper_id, job.carrier_id].includes(req.user.sub)) {
    return res.status(403).json({ error: 'Nincs jogosultság' });
  }
  if (!['delivered', 'completed'].includes(job.status)) {
    return res.status(409).json({ error: 'Csak teljesített fuvarra adható értékelés' });
  }
  const revieweeId = job.shipper_id === req.user.sub ? job.carrier_id : job.shipper_id;
  try {
    const { rows } = await db.query(
      `INSERT INTO reviews (job_id, reviewer_id, reviewee_id, stars, comment)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [job_id, req.user.sub, revieweeId, stars, comment || null],
    );
    await recalcRating(revieweeId);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Már értékelted ezt a fuvart' });
    throw err;
  }
});

module.exports = router;
