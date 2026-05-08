// GoFuvar KYC HTTP route-ok.
//
// Felhasználói végpontok:
//   GET  /kyc/me                      – aktuális user KYC státusza + legutóbbi doksi
//   POST /kyc/license                 – jogosítvány feltöltés (multipart)
// Admin:
//   GET  /kyc/admin/pending           – review-ra váró doksik
//   POST /kyc/admin/:docId/approve    – jóváhagy
//   POST /kyc/admin/:docId/reject     – elutasít (body.reason)
//
// A tényleges üzleti logika a `services/kyc.js`-ben él, ez a route-réteg
// csak validál + delegál + 4xx-eket gyárt a UI-knak.

const express = require('express');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { saveFile } = require('../services/storage');
const {
  submitLicenseDocument,
  approveDocument,
  rejectDocument,
} = require('../services/kyc');

const router = express.Router();
// 8 MB elég bőven egy jogosítvány fotóra (a fotó-route 10 MB-ot enged).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// GET /kyc/me — user KYC státusza
//
// Ez egyetlen forrás-objektum a UI-knak: a hub banner, a profil státusz-kártya,
// és a licit-blokkolás üzenet mind ebből olvas. Ezért tartalmaz mind a user-szintű
// (kyc_status, can_bid, license_expiry), mind a doksi-szintű (status, rejection_reason)
// mezőket.
router.get('/kyc/me', authRequired, async (req, res) => {
  const uid = req.user.sub;
  const [userRes, docRes] = await Promise.all([
    db.query(
      `SELECT kyc_status, kyc_verified_at, license_expiry, can_bid
         FROM users WHERE id = $1`,
      [uid],
    ),
    db.query(
      `SELECT id, doc_type, file_url, doc_number, full_name_on_doc, expiry_date,
              status, reviewed_at, rejection_reason, created_at
         FROM kyc_documents
        WHERE user_id = $1 AND doc_type = 'drivers_license'
        ORDER BY created_at DESC LIMIT 1`,
      [uid],
    ),
  ]);
  if (!userRes.rows[0]) return res.status(404).json({ error: 'Felhasználó nem található' });
  res.json({
    ...userRes.rows[0],
    document: docRes.rows[0] || null,
  });
});

// POST /kyc/license — multipart upload
// Mezők:
//   file          (kép)              kötelező
//   doc_number    (szöveg)           opcionális
//   full_name     (szöveg)           opcionális (a doksin lévő név)
//   expiry_date   (YYYY-MM-DD)       kötelező — e nélkül nincs lejárati cron logika
router.post('/kyc/license', authRequired, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  const { doc_number, full_name, expiry_date } = req.body || {};
  if (!expiry_date) {
    return res.status(400).json({ error: 'A lejárati dátum kötelező (YYYY-MM-DD).' });
  }
  // Egyszerű dátum-validáció: ne lehessen múltbeli lejáratot feltölteni.
  const exp = new Date(expiry_date);
  if (Number.isNaN(exp.getTime())) {
    return res.status(400).json({ error: 'Érvénytelen lejárati dátum.' });
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (exp < today) {
    return res.status(400).json({ error: 'A megadott lejárati dátum már elmúlt.' });
  }

  let fileUrl;
  try {
    fileUrl = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  } catch (err) {
    console.error('[kyc] storage save failed:', err.message);
    return res.status(500).json({ error: 'Fájl mentés sikertelen' });
  }

  const doc = await submitLicenseDocument({
    userId: req.user.sub,
    fileUrl,
    docNumber: doc_number || null,
    fullName: full_name || null,
    expiryDate: expiry_date,
  });
  res.status(201).json({ document: doc });
});

// ---- ADMIN ----
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Csak admin' });
  next();
}

// GET /kyc/admin/pending — review-ra váró doksik (legrégebbi felül)
router.get('/kyc/admin/pending', authRequired, requireAdmin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.id, d.user_id, d.doc_type, d.file_url, d.doc_number, d.full_name_on_doc,
            d.expiry_date, d.status, d.created_at,
            u.full_name, u.email
       FROM kyc_documents d
       JOIN users u ON u.id = d.user_id
      WHERE d.status = 'pending'
      ORDER BY d.created_at ASC`,
  );
  res.json(rows);
});

// POST /kyc/admin/:docId/approve
router.post('/kyc/admin/:docId/approve', authRequired, requireAdmin, async (req, res) => {
  const doc = await approveDocument(req.params.docId, req.user.sub);
  if (!doc) return res.status(404).json({ error: 'Dokumentum nem található' });
  res.json({ document: doc });
});

// POST /kyc/admin/:docId/reject  body: { reason }
router.post('/kyc/admin/:docId/reject', authRequired, requireAdmin, async (req, res) => {
  const reason = (req.body && req.body.reason) || null;
  const doc = await rejectDocument(req.params.docId, req.user.sub, reason);
  if (!doc) return res.status(404).json({ error: 'Dokumentum nem található' });
  res.json({ document: doc });
});

module.exports = router;
