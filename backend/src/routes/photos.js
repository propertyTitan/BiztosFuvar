// Fotó-feltöltés (Proof of Delivery 2.0).
// - Memóriából tölti fel a multipart fájlt.
// - GPS koordináta BIZONYÍTÉKKÉNT rögzítődik (vita esetén "hol volt a sofőr").
// - A dropoff validáció 6 számjegyű ÁTVÉTELI KÓD alapján történik: a sofőr
//   beírja a feladótól kapott kódot, és ha egyezik, a fuvar 'delivered' lesz.
// - Az AI elemzést (Gemini) kivettük: a fotó csak bizonyíték, nem kerül
//   automatikus minősítés alá.
// - Sikeres validáció után az escrow letét felszabadul ('released').
const express = require('express');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const realtime = require('../realtime');
const barion = require('../services/barion');
const { createNotification } = require('../services/notifications');
const { sendEmail } = require('../services/email');
const { saveFile } = require('../services/storage');

const router = express.Router();
// 10 MB kép-korlát: memóriából dolgozunk, mert a storage service
// kapja meg a buffer-t és eldönti, hova ír (Cloudflare R2 / disk).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Fallback: ha valami miatt a storage hívás nem megy, base64 data URL
function encodeAsDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

const ALLOWED_KINDS = ['listing', 'pickup', 'dropoff', 'damage', 'document'];

// POST /jobs/:jobId/photos
//   multipart/form-data:
//     file         – a kép
//     kind         – 'listing' / 'pickup' / 'dropoff' / 'damage' / 'document'
//     gps_lat,gps_lng,gps_accuracy_m – opcionális, de rögzítjük ha van
//     delivery_code – CSAK dropoff esetén kötelező, a feladótól kapott 6 jegyű kód
router.post('/jobs/:jobId/photos', authRequired, upload.single('file'), async (req, res) => {
  const { jobId } = req.params;
  const { kind, gps_lat, gps_lng, gps_accuracy_m, delivery_code } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  if (!ALLOWED_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Érvénytelen kind' });
  }

  const { rows: jobRows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });

  // Jogosultság: 'listing' fotót csak a feladó tölthet fel; minden más
  // (pickup/dropoff/damage/document) csak a kijelölt sofőré.
  if (kind === 'listing') {
    if (job.shipper_id !== req.user.sub) {
      return res.status(403).json({ error: 'Csak a feladó tölthet fel hirdetés fotót' });
    }
  } else if (job.carrier_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a kijelölt sofőr tölthet fel pickup/dropoff fotót' });
  }

  // DROPOFF → átvételi kód kötelező, a feladó által generált kóddal kell egyezzen.
  // Ha nem egyezik: 403, NEM mentünk fotót, NEM állítunk státuszt.
  if (kind === 'dropoff') {
    if (!delivery_code || String(delivery_code).trim().length === 0) {
      return res.status(400).json({
        error: 'Hiányzó átvételi kód – kérd el a feladótól/átvevőtől a 6 számjegyű kódot',
      });
    }
    if (!job.delivery_code) {
      // Régi (migráció előtti) fuvaroknál nincs kód. Éles prototípusban
      // ezt nem szabad engedni, fallback nélkül.
      return res.status(409).json({
        error: 'Ehhez a fuvarhoz nem tartozik átvételi kód – vedd fel a kapcsolatot az ügyfélszolgálattal',
      });
    }
    if (String(delivery_code).trim() !== job.delivery_code) {
      return res.status(403).json({ error: 'Érvénytelen átvételi kód' });
    }
  }

  // Tárolás: a storage service eldönti, hogy Cloudflare R2-re vagy
  // lokális diskre írjon (env-től függően). Ha mindkettő sikertelen,
  // visszaesünk base64 data URL-re.
  let url;
  try {
    url = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  } catch (err) {
    console.warn('[photos] storage save failed, falling back to data URL:', err.message);
    url = encodeAsDataUrl(req.file);
  }

  // Mentés. Az AI elemzés-mezők mostantól mindig null-ok (csak rögzítjük a fotót,
  // nem minősítjük). A GPS log-szerűen kerül be, bizonyítékként, akkor is ha
  // nem pont a cél koordinátáján áll a sofőr.
  const { rows } = await db.query(
    `INSERT INTO photos (job_id, uploader_id, kind, url, gps_lat, gps_lng, gps_accuracy_m,
                         ai_has_cargo, ai_confidence, ai_raw_response)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,NULL,NULL) RETURNING *`,
    [
      jobId, req.user.sub, kind, url,
      gps_lat ? parseFloat(gps_lat) : null,
      gps_lng ? parseFloat(gps_lng) : null,
      gps_accuracy_m ? parseFloat(gps_accuracy_m) : null,
    ],
  );
  const photo = rows[0];

  // Workflow tranzíciók
  const validation = { ok: true };

  if (kind === 'pickup' && job.status === 'accepted') {
    await db.query(`UPDATE jobs SET status = 'in_progress', updated_at = NOW() WHERE id = $1`, [jobId]);
    realtime.emitToJob(jobId, 'job:picked_up', { job_id: jobId, photo });
  }

  if (kind === 'dropoff' && job.status === 'in_progress') {
    // A kód már validálva volt feljebb, ha eddig eljutottunk, OK-t mondunk.
    await db.query(
      `UPDATE jobs SET status = 'delivered', delivered_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [jobId],
    );

    // Jutalékmentes voucher ellenőrzés — ha a sofőrnek van, 0% jutalék
    const { useVoucherIfAvailable } = require('../services/gamification');
    let voucherUsed = false;
    if (job.carrier_id) {
      voucherUsed = await useVoucherIfAvailable(job.carrier_id, jobId, null);
      if (voucherUsed) {
        console.log(`[gamification] Voucher felhasználva! Sofőr: ${job.carrier_id}, Job: ${jobId} → 0% jutalék`);
      }
    }

    // Barion: foglalás véglegesítése — ha voucher, a sofőr 100%-ot kap
    let payout = null;
    try {
      const { rows: escrowRows } = await db.query(
        `SELECT et.barion_payment_id, et.amount_huf, u.email AS carrier_email
           FROM escrow_transactions et
           JOIN jobs j  ON j.id = et.job_id
           JOIN users u ON u.id = j.carrier_id
          WHERE et.job_id = $1`,
        [jobId],
      );
      const esc = escrowRows[0];
      if (esc && esc.barion_payment_id) {
        payout = await barion.finishReservation({
          paymentId: esc.barion_payment_id,
          jobId,
          totalHuf: esc.amount_huf,
          carrierPayee: esc.carrier_email,
        });
      }
      // Ha voucher → az escrow-ban is jelöljük hogy 0% volt a jutalék
      if (voucherUsed && esc) {
        await db.query(
          `UPDATE escrow_transactions
              SET carrier_share_huf = amount_huf, platform_share_huf = 0
            WHERE job_id = $1`,
          [jobId],
        );
      }
    } catch (err) {
      console.error('[barion] finishReservation hiba:', err.message);
    }

    // Escrow státusz frissítése (akkor is, ha Barion stub módban fut)
    await db.query(
      `UPDATE escrow_transactions
          SET status = 'released', released_at = NOW()
        WHERE job_id = $1`,
      [jobId],
    );

    validation.payout = payout;
    realtime.emitToJob(jobId, 'job:delivered', { job_id: jobId, photo, validation, payout });

    // Értesítés a FELADÓNAK: a csomagod megérkezett!
    try {
      const { rows: partyRows } = await db.query(
        `SELECT j.shipper_id, j.title, j.accepted_price_huf,
                s.full_name AS shipper_name, s.email AS shipper_email,
                c.full_name AS carrier_name
           FROM jobs j
           JOIN users s ON s.id = j.shipper_id
      LEFT JOIN users c ON c.id = j.carrier_id
          WHERE j.id = $1`,
        [jobId],
      );
      const info = partyRows[0];
      if (info) {
        await createNotification({
          user_id: info.shipper_id,
          type: 'job_delivered',
          title: '📦 A csomagod megérkezett!',
          body: `${info.carrier_name || 'A sofőr'} lerakta a csomagodat a(z) "${info.title}" fuvarban. Az átvételi kód ellenőrizve, a kifizetés automatikusan megtörtént.`,
          link: `/dashboard/fuvar/${jobId}`,
        });
        // Email is
        if (info.shipper_email) {
          setImmediate(() => {
            const { sendEmail: _send, isStub: _isStub } = require('../services/email');
            // Egyszerű inline email — a sendEmail wrapper-t használjuk
            const emailHtml = `
              <p>Szia ${info.shipper_name || 'GoFuvar felhasználó'}!</p>
              <p>Nagyszerű hír — <strong>${info.carrier_name || 'a sofőr'}</strong> sikeresen lerakta a csomagodat a(z) <strong>"${info.title}"</strong> fuvarban!</p>
              <p style="font-size:20px;font-weight:800;color:#16a34a;margin:16px 0">✅ Kézbesítve</p>
              <p>A 6 jegyű átvételi kód ellenőrizve, a Barion letét felszabadult. A sofőr megkapta a díjazását (90%), a platform jutalék (10%) levonva.</p>
              <p>Ha bármi probléma van a csomagoddal, a fuvar részletek oldalán tudsz vitás esetet nyitni.</p>
            `;
            sendEmail({
              to: info.shipper_email,
              subject: `✅ Kézbesítve: ${info.title}`,
              html: emailHtml,
            }).catch((e) => console.warn('[email] job_delivered hiba:', e.message));
          });
        }
      }
    } catch (e) {
      console.warn('[notifications] job_delivered hiba:', e.message);
    }

    // Trust score + szint + jelvények újraszámolása a sofőrnek
    if (job.carrier_id) {
      setImmediate(async () => {
        try {
          const { recalcTrustScore } = require('../services/trustScore');
          const { recalcLevel } = require('../services/gamification');
          await recalcTrustScore(job.carrier_id);
          const result = await recalcLevel(job.carrier_id);
          if (result.leveledUp) {
            console.log(`[gamification] ${job.carrier_id} szintet lépett: Level ${result.level} (${result.levelName})`);
          }
          if (result.newBadges.length > 0) {
            console.log(`[gamification] Új jelvények: ${result.newBadges.map((b) => b.icon + b.name).join(', ')}`);
          }
        } catch (e) {
          console.warn('[gamification] hiba:', e.message);
        }
      });
    }
  }

  res.status(201).json({ photo, validation });
});

// GET /jobs/:jobId/photos
router.get('/jobs/:jobId/photos', authRequired, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM photos WHERE job_id = $1 ORDER BY taken_at ASC',
    [req.params.jobId],
  );
  res.json(rows);
});

module.exports = router;
