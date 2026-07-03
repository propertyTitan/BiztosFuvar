// Fotó-feltöltés (Proof of Delivery 2.0).
// - Memóriából tölti fel a multipart fájlt.
// - GPS koordináta BIZONYÍTÉKKÉNT rögzítődik (vita esetén "hol volt a sofőr").
// - A dropoff validáció 6 számjegyű ÁTVÉTELI KÓD alapján történik: a sofőr
//   beírja a feladótól kapott kódot, és ha egyezik, a fuvar 'delivered' lesz.
// - Az AI elemzést (Gemini) kivettük: a fotó csak bizonyíték, nem kerül
//   automatikus minősítés alá.
// - Sikeres validáció után az escrow letét felszabadul ('released').
const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const realtime = require('../realtime');
const barion = require('../services/barion');
const { createNotification } = require('../services/notifications');
const { sendEmail } = require('../services/email');
const { saveFile } = require('../services/storage');
const { getJobParty } = require('../utils/jobAccess');

const router = express.Router();
// 10 MB kép-korlát: memóriából dolgozunk, mert a storage service
// kapja meg a buffer-t és eldönti, hova ír (Cloudflare R2 / disk).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Fallback: ha valami miatt a storage hívás nem megy, base64 data URL
function encodeAsDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

const ALLOWED_KINDS = ['listing', 'pickup', 'dropoff', 'damage', 'document'];

// Konstans idejű kód-összehasonlítás: hash-elt formában vetjük össze, így a
// hossz-eltérés sem szivárogtat, és a timingSafeEqual feltétele is teljesül.
function codesMatch(input, expected) {
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

const MAX_CODE_ATTEMPTS = 5;

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
  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Csak képfájl tölthető fel (JPG/PNG).' });
  }
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

  // Terminál-státusz védelem: ha a fuvar már lezárult vagy lemondva, ne
  // fogadjunk el további felvételi/lerakodási fotót. Pénzügyi kárt a
  // státusz-feltételes payout eddig is megakadályozott, de e nélkül a
  // végpont 201-gyel elfogadta a felesleges fotót, ami szennyezte a
  // bizonyíték-galériát és félrevezető volt.
  const TERMINAL_STATUSES = ['delivered', 'completed', 'cancelled'];
  if ((kind === 'pickup' || kind === 'dropoff') && TERMINAL_STATUSES.includes(job.status)) {
    return res.status(409).json({
      error: `Ez a fuvar már lezárult (státusz: ${job.status}). Nem tölthető fel további felvételi vagy lerakodási fotó.`,
    });
  }

  // Fizetési guard: a munka (felvétel/kézbesítés) CSAK azután indulhat,
  // hogy a feladó megfizette a kapcsolatfelvételi díjat. Enélkül a fuvar
  // a platformon kívül bonyolódna (a díj a platform egyetlen bevétele —
  // készpénzes modell). A feladó utólag is fizethet (confirm-payment),
  // utána a fotó-feltöltés újra megengedett.
  if ((kind === 'pickup' || kind === 'dropoff') && !job.paid_at) {
    return res.status(409).json({
      error: 'A feladó még nem fizette meg a kapcsolatfelvételi díjat — a munka csak ezután kezdhető el.',
    });
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
    // Brute-force védelem: 5 hibás próba után 1 órás zárolás. A 6 jegyű kód
    // az escrow-felszabadítás kulcsa, próbálgatással nem lehet kitalálni.
    if (job.delivery_code_locked_until && new Date(job.delivery_code_locked_until) > new Date()) {
      return res.status(429).json({
        error: 'Túl sok hibás kódpróbálkozás — a kód-ellenőrzés átmenetileg zárolva. Próbáld újra később, vagy hívd az ügyfélszolgálatot.',
      });
    }
    const codeInput = String(delivery_code).trim();
    const isRecipientCode = codesMatch(codeInput, job.delivery_code);
    const isSenderCode = codesMatch(codeInput, job.sender_delivery_code);
    if (!isRecipientCode && !isSenderCode) {
      const { rows: attemptRows } = await db.query(
        `UPDATE jobs
            SET delivery_code_attempts = delivery_code_attempts + 1,
                delivery_code_locked_until = CASE
                  WHEN delivery_code_attempts + 1 >= $2 THEN NOW() + INTERVAL '1 hour'
                  ELSE delivery_code_locked_until END
          WHERE id = $1
          RETURNING delivery_code_attempts`,
        [jobId, MAX_CODE_ATTEMPTS],
      );
      const attempts = attemptRows[0]?.delivery_code_attempts || 0;
      const remaining = Math.max(0, MAX_CODE_ATTEMPTS - attempts);
      return res.status(403).json({
        error: remaining > 0
          ? `Érvénytelen átvételi kód (még ${remaining} próbálkozás)`
          : 'Érvénytelen átvételi kód — túl sok hibás próbálkozás, a kód-ellenőrzés 1 órára zárolva.',
      });
    }
    // Sikeres kód → számláló nullázása
    await db.query(
      `UPDATE jobs SET delivery_code_attempts = 0, delivery_code_locked_until = NULL WHERE id = $1`,
      [jobId],
    );
    // Logolás: melyik kóddal zárult le (vita rendezéshez)
    req._closedByCodeType = isSenderCode ? 'sender_emergency' : 'recipient';
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
    // A kód már validálva volt feljebb. Atomi státusz-átmenet: két párhuzamos
    // dropoff kérés közül csak az első nyerhet — a második itt kiesik, így
    // nem indulhat dupla kifizetés.
    const claim = await db.query(
      `UPDATE jobs SET status = 'delivered', delivered_at = NOW(), updated_at = NOW(),
              closed_by_code_type = $2
        WHERE id = $1 AND status = 'in_progress'`,
      [jobId, req._closedByCodeType || 'recipient'],
    );
    if (claim.rowCount === 0) {
      return res.status(409).json({ error: 'Ezt a fuvart időközben már lezárták.' });
    }

    // Készpénzes modell: kézbesítéskor NINCS pénzmozgás a platformon — a
    // sofőr a fuvardíjat készpénzben kapja a feladótól/címzettől. A
    // kapcsolatfelvételi díj könyvelése már a fizetéskor lezárult
    // ('released'), így itt csak a státusz-átmenet + értesítések maradnak.
    realtime.emitToJob(jobId, 'job:delivered', { job_id: jobId, photo, validation });

    // Értesítés a FELADÓNAK: a csomagod megérkezett!
    try {
      const { rows: partyRows } = await db.query(
        `SELECT j.shipper_id, j.title, j.accepted_price_huf,
                j.recipient_name, j.recipient_phone,
                s.full_name AS shipper_name, s.email AS shipper_email,
                s.phone AS shipper_phone,
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
          body: `${info.carrier_name || 'A sofőr'} lerakta a csomagodat a(z) "${info.title}" fuvarban. Az átvételi kód ellenőrizve — ne feledd, a fuvardíj készpénzben jár a sofőrnek.`,
          link: `/dashboard/fuvar/${jobId}`,
        });

        // 4. SMS: feladónak — csomag kézbesítve
        setImmediate(() => {
          const { sendSms } = require('../services/sms');
          if (info.shipper_phone) {
            sendSms(info.shipper_phone,
              `A csomagod kezbesitese megtortent! Fuvar: ${info.title}. Udv, GoFuvar`
            ).catch(() => {});
          }
          // Címzettnek is — sikeres átvétel visszaigazolás
          if (info.recipient_phone) {
            sendSms(info.recipient_phone,
              `Koszonjuk! A csomag atveve. Fuvar: ${info.title}. Udv, GoFuvar`
            ).catch(() => {});
          }
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
              <p>A 6 jegyű átvételi kód ellenőrizve. A fuvardíj készpénzben jár a sofőrnek — ha még nem adtad át, kérjük rendezd vele közvetlenül.</p>
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
// A fuvar fele (feladó / kijelölt sofőr / admin) MINDEN fotót lát. Egy
// kívülálló (pl. licitálni készülő sofőr) csak a 'listing' fotókat — ezek
// a hirdetés részei, kellenek a licithez. A pickup/dropoff/damage/document
// fotók (és a beágyazott GPS-koordináták) privát bizonyítékok, ezeket
// idegen nem láthatja.
router.get('/jobs/:jobId/photos', authRequired, async (req, res) => {
  const { notFound, isParty } = await getJobParty(req.params.jobId, req.user);
  if (notFound) return res.status(404).json({ error: 'Fuvar nem található' });

  const { rows } = await db.query(
    'SELECT * FROM photos WHERE job_id = $1 ORDER BY taken_at ASC',
    [req.params.jobId],
  );
  const visible = isParty ? rows : rows.filter((p) => p.kind === 'listing');
  res.json(visible);
});

module.exports = router;
