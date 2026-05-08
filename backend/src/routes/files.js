// Egyetlen kapu minden feltöltött fájlhoz.
//
// A kliens csak a `files.id` UUID-t ismeri. A storage_key (R2 object key)
// sose megy ki. Ezen a route-on keresztül:
//   1) JWT auth (Authorization header VAGY ?t=<short-jwt>)
//   2) Jogosultság-check a kind alapján:
//        avatar       → minden authentikált user
//        kyc_license  → csak owner_id === user, vagy admin
//        job_photo    → csak a job résztvevői (shipper / carrier), vagy admin
//   3) file_access_log INSERT
//   4) streamObject() — privát R2-ből streamelünk
//
// A web kliens nem tud Authorization headert tenni `<img src="...">`-be,
// ezért külön `GET /files/:id/url` issues egy rövid lejáratú signed
// download token-t, ami `?t=...` query-paramban megy. Ez a token egy
// JWT, scoped erre az egy file_id-ra, 5 percre.

const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { saveFile, streamObject, deleteObject } = require('../services/storage');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const DOWNLOAD_TOKEN_TTL_SEC = 5 * 60; // 5 perc

// ───────── jogosultság-szabályok ─────────
async function canAccessFile(file, user) {
  if (!file) return { allowed: false, reason: 'not_found' };
  if (file.deleted_at) return { allowed: false, reason: 'deleted' };

  // Admin mindent megnézhet — de naplózva.
  if (user.role === 'admin') return { allowed: true };

  if (file.kind === 'avatar') {
    // Avatar-ok csak bejelentkezett user-eknek (nincs publikus profilkép)
    return { allowed: true };
  }

  if (file.kind === 'kyc_license') {
    // KYC szigorúan: csak az okmány tulajdonosa + admin (fent)
    return { allowed: file.owner_id === user.sub, reason: 'forbidden' };
  }

  if (file.kind === 'job_photo') {
    if (!file.job_id) return { allowed: false, reason: 'not_found' };
    const { rows } = await db.query(
      `SELECT shipper_id, carrier_id FROM jobs WHERE id = $1`,
      [file.job_id],
    );
    const job = rows[0];
    if (!job) return { allowed: false, reason: 'not_found' };
    const ok = job.shipper_id === user.sub || job.carrier_id === user.sub;
    return { allowed: ok, reason: 'forbidden' };
  }

  return { allowed: false, reason: 'forbidden' };
}

async function logAccess({ fileId, accessorId, req, result }) {
  // Best-effort; a log nem lehet a stream blokkolója
  db.query(
    `INSERT INTO file_access_log (file_id, accessor_id, ip, user_agent, result)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      fileId || null,
      accessorId || null,
      req.ip || null,
      (req.headers['user-agent'] || '').slice(0, 500),
      result,
    ],
  ).catch((e) => console.warn('[file_access_log] insert hiba:', e.message));
}

// ───────── token-issue endpoint ─────────
// GET /files/:id/url
//   válasz: { url: "/files/:id?t=...", expires_in: 300 }
// A web ezt a URL-t teszi az <img src>-be.
router.get('/files/:id/url', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, kind, owner_id, job_id, mime_type, deleted_at FROM files WHERE id = $1`,
    [req.params.id],
  );
  const file = rows[0];
  const perm = await canAccessFile(file, req.user);
  if (!perm.allowed) {
    await logAccess({ fileId: file?.id, accessorId: req.user.sub, req, result: perm.reason });
    return res.status(perm.reason === 'not_found' ? 404 : 403).json({ error: 'Nincs jogosultság' });
  }
  const token = jwt.sign(
    { fid: file.id, sub: req.user.sub },
    process.env.JWT_SECRET,
    { expiresIn: DOWNLOAD_TOKEN_TTL_SEC },
  );
  res.json({
    url: `/files/${file.id}?t=${encodeURIComponent(token)}`,
    expires_in: DOWNLOAD_TOKEN_TTL_SEC,
  });
});

// ───────── stream endpoint ─────────
// GET /files/:id   (header auth)
// GET /files/:id?t=<token>   (signed query token)
router.get('/files/:id', async (req, res) => {
  // 1) Authentikáció — header VAGY token
  let userId = null;
  let userRole = null;

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      userId = decoded.sub;
      userRole = decoded.role;
    } catch {
      await logAccess({ fileId: req.params.id, req, result: 'token_invalid' });
      return res.status(401).json({ error: 'Érvénytelen token' });
    }
  } else if (req.query.t) {
    try {
      const decoded = jwt.verify(String(req.query.t), process.env.JWT_SECRET);
      // A token csak erre a file_id-ra érvényes
      if (decoded.fid !== req.params.id) {
        await logAccess({ fileId: req.params.id, req, result: 'token_invalid' });
        return res.status(403).json({ error: 'Token nem ezt a file-t fedi' });
      }
      userId = decoded.sub;
      // A signed token-ben nem őriztük a role-t; lekérdezzük.
      const { rows: ur } = await db.query(`SELECT role FROM users WHERE id = $1`, [userId]);
      userRole = ur[0]?.role;
    } catch {
      await logAccess({ fileId: req.params.id, req, result: 'token_invalid' });
      return res.status(401).json({ error: 'Érvénytelen token' });
    }
  } else {
    return res.status(401).json({ error: 'Hiányzó token' });
  }

  // 2) File-lookup
  const { rows } = await db.query(
    `SELECT id, kind, owner_id, job_id, storage_key, storage_backend,
            mime_type, deleted_at
       FROM files WHERE id = $1`,
    [req.params.id],
  );
  const file = rows[0];

  // 3) Jogosultság
  const perm = await canAccessFile(file, { sub: userId, role: userRole });
  if (!perm.allowed) {
    await logAccess({ fileId: file?.id, accessorId: userId, req, result: perm.reason });
    return res.status(perm.reason === 'not_found' ? 404 : 410).json({ error: perm.reason });
  }

  // 4) Audit log + 5) stream
  await logAccess({ fileId: file.id, accessorId: userId, req, result: 'ok' });

  // KYC dokumentumokat soha ne mutassuk inline a böngészőben — letöltésként
  // szolgáljuk ki, hogy ne kerüljön screenshot-ba egyszerre címmel-mindennel.
  if (file.kind === 'kyc_license') {
    res.setHeader('Content-Disposition', 'attachment; filename="kyc.bin"');
  }

  try {
    await streamObject(file, res);
  } catch (err) {
    console.error('[files] stream hiba:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Stream hiba' });
  }
});

// ───────── DELETE — right-to-be-forgotten / saját törlés ─────────
// Owner vagy admin törölheti. Soft delete + tényleges R2 unlink.
router.delete('/files/:id', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, owner_id, storage_key, storage_backend, deleted_at FROM files WHERE id = $1`,
    [req.params.id],
  );
  const file = rows[0];
  if (!file) return res.status(404).json({ error: 'Nincs ilyen file' });
  if (file.deleted_at) return res.json({ ok: true, already: true });
  if (req.user.role !== 'admin' && file.owner_id !== req.user.sub) {
    return res.status(403).json({ error: 'Nincs jogosultság' });
  }
  await db.query(`UPDATE files SET deleted_at = NOW() WHERE id = $1`, [file.id]);
  try {
    await deleteObject(file);
  } catch (e) {
    console.warn('[files] R2 delete hiba (soft delete megmarad):', e.message);
  }
  res.json({ ok: true });
});

// ───────── ADMIN: file_access_log nézegető ─────────
// GET /files/admin/access-log?file_id=...&user_id=...&limit=100
router.get('/files/admin/access-log', authRequired, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Csak admin' });
  const { file_id, user_id } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const conditions = [];
  const params = [];
  if (file_id) { params.push(file_id); conditions.push(`l.file_id = $${params.length}`); }
  if (user_id) { params.push(user_id); conditions.push(`l.accessor_id = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT l.id, l.file_id, l.accessor_id, l.accessed_at, l.ip, l.user_agent, l.result,
            f.kind AS file_kind,
            u.email AS accessor_email, u.full_name AS accessor_name
       FROM file_access_log l
       LEFT JOIN files f ON f.id = l.file_id
       LEFT JOIN users u ON u.id = l.accessor_id
     ${where}
     ORDER BY l.accessed_at DESC
     LIMIT ${limit}`,
    params,
  );
  res.json(rows);
});

// ───────── Belső segéd a többi route-nak ─────────
// Egy lépésben elvégzi a saveFile + DB INSERT INTO files-t. A route-okat
// (kyc, photos, avatar) ezzel hívjuk a sajat saveFile helyett.
async function uploadAndRegister({
  buffer, originalName, mimetypeHint, kind, ownerId, jobId = null, allowPdf = false,
}) {
  const meta = await saveFile(buffer, originalName, mimetypeHint, { kind, allowPdf });
  const { rows } = await db.query(
    `INSERT INTO files (
       storage_key, storage_backend, kind, owner_id, job_id,
       mime_type, size_bytes, sha256
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      meta.storage_key, meta.storage_backend, kind, ownerId, jobId,
      meta.mime_type, meta.size_bytes, meta.sha256,
    ],
  );
  return rows[0];
}

module.exports = { router, uploadAndRegister };
