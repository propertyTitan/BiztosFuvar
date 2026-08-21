// Kétirányú értékelés (Uber-szerű) — licites fuvarokra ÉS fix áras
// foglalásokra is. A fuvar lezárása (delivered/completed) után mindkét
// fél értékelheti a másikat 1-5 csillaggal + szöveges megjegyzéssel.
const express = require('express');
const db = require('../db');
const { authRequired, requireVerifiedEmail } = require('../middleware/auth');
const { createNotification } = require('../services/notifications');
const { writeRateLimit } = require('../middleware/rateLimit');
const { detectContactLeak } = require('../utils/contactGuard');

const router = express.Router();

/** Újraszámolja a reviewee rating_avg/rating_count-ját a reviews-ból. */
async function recalcRating(userId) {
  // COALESCE(stars, rating): a régi reviews-ben `rating`, az újban `stars`
  await db.query(
    `UPDATE users
        SET rating_avg   = COALESCE((SELECT ROUND(AVG(COALESCE(stars, rating))::numeric, 1) FROM reviews WHERE reviewee_id = $1), 0),
            rating_count = (SELECT COUNT(*) FROM reviews WHERE reviewee_id = $1)
      WHERE id = $1`,
    [userId],
  );
}

// POST /reviews — értékelés beküldése (licites job VAGY fix áras booking)
router.post('/reviews', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, stars, comment } = req.body || {};

  // ⚠️ PONTOSAN AZ EGYIK (2026-08-12). Mindkét azonosítóval a korábbi kód
  // némán mindkét ágat lefuttatta és a foglalási ág írta felül az értékeltet.
  if (job_id && booking_id) {
    return res.status(400).json({
      error: 'Egyszerre csak fuvart VAGY foglalást lehet értékelni.',
      code: 'AMBIGUOUS_ENTITY',
    });
  }

  if (!stars || stars < 1 || stars > 5) {
    return res.status(400).json({ error: 'Adj meg 1 és 5 közötti csillagot.' });
  }
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg egy fuvar (job_id) vagy foglalás (booking_id) azonosítót.' });
  }
  // Kapcsolat-szivárgás szűrés a nyilvános értékelés-kommenten (2026-08-09,
  // 2. audit-kör F7). Az értékelés a publikus profilon TARTÓSAN látszik
  // mindenkinek — egy telefonszám itt állandó „platformon kívül hívj" hirdetés
  // lenne a jövőbeli feladóknak. Egy értékelésben sosem indokolt elérhetőség,
  // ezért itt (a vitával ellentétben) fizetés után is szűrünk.
  const commentLeak = detectContactLeak(comment);
  if (commentLeak) return res.status(400).json({ error: commentLeak, code: 'CONTACT_LEAK' });

  let revieweeId = null;
  let entityTitle = '';

  if (job_id) {
    const { rows } = await db.query(
      'SELECT shipper_id, carrier_id, title, status, delivered_at FROM jobs WHERE id = $1',
      [job_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
    const j = rows[0];
    // ⚠️ A KÉZBESÍTÉS UTÁNI VITA NEM VESZI EL AZ ÉRTÉKELÉST (2026-08-21,
    // Manus-teszt): a kézbesített fuvarra nyitott vita 'disputed'-be tette a
    // státuszt, és ezzel az értékelés végleg eltűnt — pedig az élmény pont
    // ilyenkor a legfontosabb visszajelzés, és a vita meg az értékelés két
    // külön csatorna. A kézbesítés ELŐTTI vitában viszont továbbra sem lehet
    // értékelni: ott a szolgáltatás (a kézbesítés) még meg sem történt.
    const ertekelheto = ['delivered', 'completed'].includes(j.status)
      || (j.status === 'disputed' && j.delivered_at);
    if (!ertekelheto) {
      return res.status(409).json({ error: 'Értékelni a kézbesítés után lehet (vitatott fuvarnál is, ha a csomag már kézbesült).' });
    }
    if (j.shipper_id !== req.user.sub && j.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Csak az érintett felek értékelhetnek.' });
    }
    revieweeId = j.shipper_id === req.user.sub ? j.carrier_id : j.shipper_id;
    entityTitle = j.title;
  }

  if (booking_id) {
    const { rows } = await db.query(
      `SELECT b.shipper_id, r.carrier_id, r.title, b.status, b.delivered_at
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE b.id = $1`,
      [booking_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Foglalás nem található' });
    const b = rows[0];
    const bErtekelheto = ['delivered', 'completed'].includes(b.status)
      || (b.status === 'disputed' && b.delivered_at);
    if (!bErtekelheto) {
      return res.status(409).json({ error: 'Értékelni a kézbesítés után lehet (vitatott foglalásnál is, ha a csomag már kézbesült).' });
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
    // Kompatibilis INSERT: a régi reviews tábla `rating NOT NULL`-t vár,
    // a `booking_id` és `stars` oszlopok pedig lehet hogy nem léteznek.
    // Ezért először megpróbáljuk az új formátumot, és ha az nem megy,
    // fallback-elünk a régire.
    let review;
    try {
      const { rows } = await db.query(
        `INSERT INTO reviews (job_id, booking_id, reviewer_id, reviewee_id, stars, rating, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        // ⚠️ PONTOSAN AZ EGYIK AZONOSÍTÓ (2026-08-12, 078-as migráció).
        // Ha a kérés mindkettőt küldi, korábban MINDKÉT ág lefutott, a
        // revieweeId-t a foglalási ág felülírta, és a sor mindkét
        // azonosítóval mentődött. A DB-kényszer ezt már kizárja; itt a
        // válasz legyen beszédes, ne 500-as constraint-hiba.
        [booking_id ? null : (job_id || null), booking_id || null,
          req.user.sub, revieweeId, stars, stars, comment || null],
      );
      review = rows[0];
    } catch (insertErr) {
      // Ha a booking_id vagy stars oszlop nem létezik, próbáljuk régi formátummal
      if (insertErr.code === '42703') {
        console.warn('[reviews] fallback INSERT (régi séma):', insertErr.message);
        const { rows } = await db.query(
          `INSERT INTO reviews (job_id, reviewer_id, reviewee_id, rating, comment)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [job_id, req.user.sub, revieweeId, stars, comment || null],
        );
        review = rows[0];
      } else {
        throw insertErr;
      }
    }
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
router.get('/reviews', authRequired, requireVerifiedEmail, async (req, res) => {
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
  // ⚠️ A KAPCSOLAT-SZŰRŐ ITT IS FUT (2026-08-09, audit). A fő `POST /reviews`
  // a 2. audit-kör óta szűr, ez a visszafelé kompatibilis ág viszont
  // duplikálja a logikát — és a szűrés kimaradt belőle. Az értékelés-komment
  // TARTÓSAN, mindenkinek látszik a publikus profilon: egy „hívj közvetlenül:
  // 06 30…" szöveggel a díj (a platform egyetlen bevétele) megkerülhető volt.
  const legacyLeak = detectContactLeak(comment);
  if (legacyLeak) return res.status(400).json({ error: legacyLeak, code: 'CONTACT_LEAK' });
  const { rows: jobRows } = await db.query(
    'SELECT shipper_id, carrier_id, title, status, delivered_at FROM jobs WHERE id = $1',
    [job_id],
  );
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });
  if (![job.shipper_id, job.carrier_id].includes(req.user.sub)) {
    return res.status(403).json({ error: 'Nincs jogosultság' });
  }
  // Ugyanaz a szabály, mint a fő /reviews végponton (2026-08-21): a
  // kézbesítés utáni vita nem veszi el az értékelést. KÉT végpont — a
  // védelem ne csak az egyiken éljen.
  if (!(['delivered', 'completed'].includes(job.status)
    || (job.status === 'disputed' && job.delivered_at))) {
    return res.status(409).json({ error: 'Értékelni a kézbesítés után lehet (vitatott fuvarnál is, ha a csomag már kézbesült).' });
  }
  const revieweeId = job.shipper_id === req.user.sub ? job.carrier_id : job.shipper_id;
  try {
    const { rows } = await db.query(
      `INSERT INTO reviews (job_id, reviewer_id, reviewee_id, stars, rating, comment)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [job_id, req.user.sub, revieweeId, stars, stars, comment || null],
    );
    await recalcRating(revieweeId);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Már értékelted ezt a fuvart' });
    throw err;
  }
});

module.exports = router;
