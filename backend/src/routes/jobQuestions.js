// =====================================================================
//  Publikus kérdés-válasz (Q&A) a fuvarokhoz.
//
//  Endpoint-ok:
//    GET  /jobs/:jobId/questions       — Q&A listája (bárki látja)
//    POST /jobs/:jobId/questions       — kérdés (auth, nyitott fuvarokra)
//    POST /questions/:id/answer        — válasz (csak a feladó)
//    PATCH /questions/:id/hide         — moderálás (csak admin)
//
//  Kapcsolat-szivárgás védelem: minden kérdés / válasz szövege átmegy
//  a contactGuard-on, ha telefonszám/email találat → 400 hiba.
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');
const { detectContactLeak } = require('../utils/contactGuard');

const router = express.Router();

// Nyitott állapotok: ezekben még lehet kérdezni
// (accepted / in_progress / delivered után már zárt — szerződéskötés megtörtént)
const OPEN_STATUSES = ['pending', 'bidding'];

// GET /jobs/:jobId/questions — bárki látja a Q&A-t
router.get('/jobs/:jobId/questions', authRequired, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT q.id, q.question, q.answer, q.created_at, q.answered_at,
              u_ask.full_name AS asker_name, u_ask.id AS asker_id,
              u_ans.full_name AS answerer_name
         FROM job_questions q
         LEFT JOIN users u_ask ON u_ask.id = q.asker_id
         LEFT JOIN users u_ans ON u_ans.id = q.answered_by
        WHERE q.job_id = $1
          AND q.hidden = false
        ORDER BY q.created_at DESC`,
      [req.params.jobId],
    );
    res.json(rows);
  } catch (err) {
    console.error('[questions] GET hiba:', err.message);
    res.status(500).json({ error: 'Lekérdezési hiba' });
  }
});

// POST /jobs/:jobId/questions — új kérdés
router.post('/jobs/:jobId/questions', authRequired, writeRateLimit, async (req, res) => {
  const { question } = req.body || {};
  if (!question || !question.trim() || question.trim().length < 5) {
    return res.status(400).json({ error: 'A kérdés minimum 5 karakter legyen.' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: 'A kérdés maximum 500 karakter lehet.' });
  }

  // Telefon/email-szűrés
  const leak = detectContactLeak(question);
  if (leak) return res.status(400).json({ error: leak });

  try {
    // Ellenőrizzük hogy a fuvar még nyitott
    const { rows: jobRows } = await db.query(
      `SELECT id, shipper_id, status FROM jobs WHERE id = $1`,
      [req.params.jobId],
    );
    const job = jobRows[0];
    if (!job) return res.status(404).json({ error: 'Fuvar nem található.' });
    if (!OPEN_STATUSES.includes(job.status)) {
      return res.status(409).json({
        error: 'Ezt a fuvart már elfogadták / lezárták — kérdés feltétele nem lehetséges.',
      });
    }

    // A feladó NEM kérdezhet saját fuvarára (válaszolnia kell, nem kérdeznie)
    if (job.shipper_id === req.user.sub) {
      return res.status(403).json({
        error: 'A saját fuvarodra nem írhatsz kérdést — válaszolj a beérkező kérdésekre.',
      });
    }

    const { rows } = await db.query(
      `INSERT INTO job_questions (job_id, asker_id, question)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.jobId, req.user.sub, question.trim()],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[questions] POST hiba:', err.message);
    res.status(500).json({ error: 'Mentési hiba' });
  }
});

// POST /questions/:id/answer — válasz (csak a feladó)
router.post('/questions/:id/answer', authRequired, writeRateLimit, async (req, res) => {
  const { answer } = req.body || {};
  if (!answer || !answer.trim() || answer.trim().length < 1) {
    return res.status(400).json({ error: 'A válasz nem lehet üres.' });
  }
  if (answer.length > 1000) {
    return res.status(400).json({ error: 'A válasz maximum 1000 karakter lehet.' });
  }

  const leak = detectContactLeak(answer);
  if (leak) return res.status(400).json({ error: leak });

  try {
    // Csak a fuvar feladója válaszolhat
    const { rows: qRows } = await db.query(
      `SELECT q.id, q.job_id, j.shipper_id
         FROM job_questions q
         JOIN jobs j ON j.id = q.job_id
        WHERE q.id = $1`,
      [req.params.id],
    );
    const q = qRows[0];
    if (!q) return res.status(404).json({ error: 'Kérdés nem található.' });
    if (q.shipper_id !== req.user.sub) {
      return res.status(403).json({
        error: 'Csak a fuvar feladója válaszolhat a saját fuvarára érkező kérdésekre.',
      });
    }

    const { rows } = await db.query(
      `UPDATE job_questions
          SET answer = $1, answered_by = $2, answered_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [answer.trim(), req.user.sub, req.params.id],
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[questions] answer hiba:', err.message);
    res.status(500).json({ error: 'Mentési hiba' });
  }
});

// PATCH /questions/:id/hide — admin moderáció
router.patch('/questions/:id/hide', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Csak admin.' });
  try {
    const { rows } = await db.query(
      `UPDATE job_questions SET hidden = true WHERE id = $1 RETURNING id`,
      [req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Nincs ilyen kérdés.' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Hiba' });
  }
});

module.exports = router;
