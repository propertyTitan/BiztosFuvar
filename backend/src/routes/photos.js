// Fotó-feltöltés (Proof of Delivery 2.0).
// - Memóriából tölti fel a multipart fájlt.
// - GPS koordináta BIZONYÍTÉKKÉNT rögzítődik (vita esetén "hol volt a szállító").
// - A dropoff validáció 6 számjegyű ÁTVÉTELI KÓD alapján történik: a szállító
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
const { maybeGrantReferralReward } = require('../services/referral');
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
  // Magic-byte ellenőrzés (audit 2. tétel) — tartalom dönt, nem a kliens
  const sniffedJob = require('../utils/imageSniff').sniffImageType(req.file.buffer);
  if (!sniffedJob) {
    return res.status(400).json({ error: 'A fájl nem érvényes képfájl (JPG/PNG/WebP/HEIC fogadott).' });
  }
  req.file.mimetype = sniffedJob;
  if (!ALLOWED_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Érvénytelen kind' });
  }

  const { rows: jobRows } = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  const job = jobRows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });

  // Jogosultság: 'listing' fotót csak a feladó tölthet fel; minden más
  // (pickup/dropoff/damage/document) csak a kijelölt szállítóé.
  if (kind === 'listing') {
    if (job.shipper_id !== req.user.sub) {
      return res.status(403).json({ error: 'Csak a feladó tölthet fel hirdetés fotót' });
    }
  } else if (job.carrier_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak a kijelölt szállító tölthet fel pickup/dropoff fotót' });
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
  // nem pont a cél koordinátáján áll a szállító.
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

    // AZ EGYETLEN CÍMZETT-SMS (2026-07-13 user-döntés): a csomag
    // felvételekor megy ki, az átvételhez szükséges adatokkal — 6 jegyű
    // kód + a szállító neve/telefonszáma. Minden más értesítés email/in-app
    // (SMS ~20-30 Ft/db, email ~0). Ékezet nélkül: 1 GSM-szegmens maradjon.
    setImmediate(async () => {
      try {
        const { rows: pickRows } = await db.query(
          `SELECT j.recipient_phone, j.delivery_code,
                  c.full_name AS carrier_name, c.phone AS carrier_phone
             FROM jobs j
        LEFT JOIN users c ON c.id = j.carrier_id
            WHERE j.id = $1`,
          [jobId],
        );
        const pi = pickRows[0];
        if (pi && pi.recipient_phone && pi.delivery_code) {
          const { sendSms } = require('../services/sms');
          // Név-plafon: az üzenet 134 karakter alatt maradjon (= max 2
          // UCS-2 szegmens; a "Szállító" szó +3 kar → cap 20)
          const nev = (pi.carrier_name || '').slice(0, 20);
          const sofor = nev
            ? ` Szállító: ${nev}${pi.carrier_phone ? ` (${pi.carrier_phone})` : ''}.`
            : '';
          sendSms(pi.recipient_phone,
            `GoFuvar: úton a csomagod! Átvételi kód: ${pi.delivery_code}.${sofor} Kérjük, egyeztess vele az érkezésről.`,
          ).catch(() => {});
        }
      } catch (e) {
        console.warn('[sms] pickup ertesites hiba:', e.message);
      }
    });
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
    // szállító a fuvardíjat készpénzben kapja a feladótól/címzettől. A
    // kapcsolatfelvételi díj könyvelése már a fizetéskor lezárult
    // ('released'), így itt csak a státusz-átmenet + értesítések maradnak.
    realtime.emitToJob(jobId, 'job:delivered', { job_id: jobId, photo, validation });

    // Ajánlói jutalom-trigger: a szállító most zárta le a fuvarját → ha ő egy
    // meghívott, és ez az első teljesített fuvarja, az ajánlója kupont kap.
    maybeGrantReferralReward(job.carrier_id, { role: 'carrier', jobId }).catch(() => {});

    // Értesítés a FELADÓNAK: a csomagod megérkezett!
    try {
      const { rows: partyRows } = await db.query(
        `SELECT j.shipper_id, j.title, j.accepted_price_huf,
                j.recipient_name, j.recipient_phone, j.recipient_email,
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
          body: `${info.carrier_name || 'A szállító'} lerakta a csomagodat a(z) "${info.title}" fuvarban. Az átvételi kód ellenőrizve — ne feledd, a fuvardíj készpénzben jár a szállítónak.`,
          link: `/dashboard/fuvar/${jobId}`,
        });

        // SMS-MODELL (2026-07-13): kézbesítésről SMS NINCS — email megy a
        // feladónak (lent) és a címzettnek is, ha adott email-címet.
        if (info.recipient_email) {
          setImmediate(() => {
            const { sendEmail: _sendR } = require('../services/email');
            _sendR({
              to: info.recipient_email,
              subject: `✅ Csomag átvéve: ${info.title}`,
              html: `
                <p>Szia${info.recipient_name ? ` ${info.recipient_name}` : ''}!</p>
                <p>A(z) <strong>"${info.title}"</strong> csomag kézbesítése megtörtént — az átvételi kód ellenőrizve.</p>
                <p>Köszönjük, hogy a GoFuvart használtátok!</p>
              `,
            }).catch((e) => console.warn('[email] recipient delivered hiba:', e.message));
          });
        }
        // Email is
        if (info.shipper_email) {
          setImmediate(() => {
            const { sendEmail: _send, isStub: _isStub } = require('../services/email');
            // Egyszerű inline email — a sendEmail wrapper-t használjuk
            const emailHtml = `
              <p>Szia ${info.shipper_name || 'GoFuvar felhasználó'}!</p>
              <p>Nagyszerű hír — <strong>${info.carrier_name || 'a szállító'}</strong> sikeresen lerakta a csomagodat a(z) <strong>"${info.title}"</strong> fuvarban!</p>
              <p style="font-size:20px;font-weight:800;color:#16a34a;margin:16px 0">✅ Kézbesítve</p>
              <p>A 6 jegyű átvételi kód ellenőrizve. A fuvardíj készpénzben jár a szállítónak — ha még nem adtad át, kérjük rendezd vele közvetlenül.</p>
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

    // Trust score + szint + jelvények újraszámolása a szállítónak
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

// ============================================================
// FOGLALÁS (route_bookings) — felvétel + kézbesítés (BUG-041)
// ============================================================
//
// A fix áras foglalás lezárási útja — a licites fuvarok pickup/dropoff
// flow-jának tükre:
//   confirmed (+ díj fizetve) --pickup fotó--> in_progress
//   in_progress --dropoff fotó + helyes kód--> delivered
// Ugyanaz a paid-guard, kód brute-force lockout és terminál-védelem.

// POST /route-bookings/:bookingId/photos
//   multipart/form-data: file, kind (pickup/dropoff/damage/document),
//   gps_lat/gps_lng/gps_accuracy_m, delivery_code (dropoff-nál kötelező)
router.post('/route-bookings/:bookingId/photos', authRequired, upload.single('file'), async (req, res) => {
  const { bookingId } = req.params;
  const { kind, gps_lat, gps_lng, gps_accuracy_m, delivery_code } = req.body;
  if (!req.file) return res.status(400).json({ error: 'Hiányzó fájl' });
  if (!req.file.mimetype || !req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ error: 'Csak képfájl tölthető fel (JPG/PNG).' });
  }
  // Magic-byte ellenőrzés (audit 2. tétel) — tartalom dönt, nem a kliens
  const sniffedBooking = require('../utils/imageSniff').sniffImageType(req.file.buffer);
  if (!sniffedBooking) {
    return res.status(400).json({ error: 'A fájl nem érvényes képfájl (JPG/PNG/WebP/HEIC fogadott).' });
  }
  req.file.mimetype = sniffedBooking;
  const BOOKING_KINDS = ['pickup', 'dropoff', 'damage', 'document'];
  if (!BOOKING_KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Érvénytelen kind' });
  }

  const { rows: bRows } = await db.query(
    `SELECT b.*, r.carrier_id, r.title AS route_title
       FROM route_bookings b
       JOIN carrier_routes r ON r.id = b.route_id
      WHERE b.id = $1`,
    [bookingId],
  );
  const booking = bRows[0];
  if (!booking) return res.status(404).json({ error: 'Foglalás nem található' });

  // Csak a kijelölt szállító dolgozhat a foglaláson
  if (booking.carrier_id !== req.user.sub) {
    return res.status(403).json({ error: 'Csak az útvonal szállítója tölthet fel pickup/dropoff fotót' });
  }

  // Terminál-státusz védelem
  const TERMINAL = ['delivered', 'cancelled', 'rejected'];
  if (TERMINAL.includes(booking.status)) {
    return res.status(409).json({
      error: `Ez a foglalás már lezárult (státusz: ${booking.status}). Nem tölthető fel további fotó.`,
    });
  }

  // Fizetési guard: a munka csak a kapcsolatfelvételi díj beérkezése után
  // indulhat (a fuvarokkal azonos szabály)
  if ((kind === 'pickup' || kind === 'dropoff') && !booking.paid_at) {
    return res.status(409).json({
      error: 'A feladó még nem fizette meg a kapcsolatfelvételi díjat — a munka csak ezután kezdhető el.',
    });
  }

  // DROPOFF → átvételi kód kötelező (a címzett SMS-ben kapta)
  if (kind === 'dropoff') {
    if (booking.status !== 'in_progress') {
      return res.status(409).json({ error: 'A kézbesítés csak felvett (folyamatban lévő) foglaláson igazolható.' });
    }
    if (!delivery_code || String(delivery_code).trim().length === 0) {
      return res.status(400).json({
        error: 'Hiányzó átvételi kód – kérd el az átvevőtől a 6 számjegyű kódot',
      });
    }
    if (!booking.delivery_code) {
      return res.status(409).json({
        error: 'Ehhez a foglaláshoz nem tartozik átvételi kód – vedd fel a kapcsolatot az ügyfélszolgálattal',
      });
    }
    // Brute-force védelem: 5 hibás próba után 1 órás zárolás
    if (booking.delivery_code_locked_until && new Date(booking.delivery_code_locked_until) > new Date()) {
      return res.status(429).json({
        error: 'Túl sok hibás kódpróbálkozás — a kód-ellenőrzés átmenetileg zárolva. Próbáld újra később, vagy hívd az ügyfélszolgálatot.',
      });
    }
    if (!codesMatch(String(delivery_code).trim(), booking.delivery_code)) {
      const { rows: attemptRows } = await db.query(
        `UPDATE route_bookings
            SET delivery_code_attempts = delivery_code_attempts + 1,
                delivery_code_locked_until = CASE
                  WHEN delivery_code_attempts + 1 >= $2 THEN NOW() + INTERVAL '1 hour'
                  ELSE delivery_code_locked_until END
          WHERE id = $1
          RETURNING delivery_code_attempts`,
        [bookingId, MAX_CODE_ATTEMPTS],
      );
      const attempts = attemptRows[0]?.delivery_code_attempts || 0;
      const remaining = Math.max(0, MAX_CODE_ATTEMPTS - attempts);
      return res.status(403).json({
        error: remaining > 0
          ? `Érvénytelen átvételi kód (még ${remaining} próbálkozás)`
          : 'Érvénytelen átvételi kód — túl sok hibás próbálkozás, a kód-ellenőrzés 1 órára zárolva.',
      });
    }
    await db.query(
      `UPDATE route_bookings SET delivery_code_attempts = 0, delivery_code_locked_until = NULL WHERE id = $1`,
      [bookingId],
    );
  }

  // Tárolás (R2 / disk / base64 fallback — a fuvar-fotókkal azonos út)
  let url;
  try {
    url = await saveFile(req.file.buffer, req.file.originalname, req.file.mimetype);
  } catch (err) {
    console.warn('[photos] storage save failed, falling back to data URL:', err.message);
    url = encodeAsDataUrl(req.file);
  }

  const { rows } = await db.query(
    `INSERT INTO photos (booking_id, uploader_id, kind, url, gps_lat, gps_lng, gps_accuracy_m)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      bookingId, req.user.sub, kind, url,
      gps_lat ? parseFloat(gps_lat) : null,
      gps_lng ? parseFloat(gps_lng) : null,
      gps_accuracy_m ? parseFloat(gps_accuracy_m) : null,
    ],
  );
  const photo = rows[0];

  // ---- Státusz-átmenetek ----
  if (kind === 'pickup' && booking.status === 'confirmed') {
    await db.query(
      `UPDATE route_bookings SET status = 'in_progress' WHERE id = $1`,
      [bookingId],
    );
    realtime.emitToUser(booking.shipper_id, 'route-booking:picked_up', { booking_id: bookingId, photo });
    realtime.emitToUser(booking.carrier_id, 'route-booking:picked_up', { booking_id: bookingId, photo });

    // AZ EGYETLEN CÍMZETT-SMS a foglalás-ágon is (2026-07-13): felvételkor,
    // kód + szállító elérhetőség. Ékezet nélkül (1 GSM-szegmens).
    setImmediate(async () => {
      try {
        if (booking.recipient_phone && booking.delivery_code) {
          const { rows: cRows } = await db.query(
            `SELECT full_name, phone FROM users WHERE id = $1`,
            [booking.carrier_id],
          );
          const c = cRows[0] || {};
          const { sendSms } = require('../services/sms');
          const nev = (c.full_name || '').slice(0, 20);
          const sofor = nev
            ? ` Szállító: ${nev}${c.phone ? ` (${c.phone})` : ''}.`
            : '';
          sendSms(booking.recipient_phone,
            `GoFuvar: úton a csomagod! Átvételi kód: ${booking.delivery_code}.${sofor} Kérjük, egyeztess vele az érkezésről.`,
          ).catch(() => {});
        }
      } catch (e) {
        console.warn('[sms] booking pickup ertesites hiba:', e.message);
      }
    });
    createNotification({
      user_id: booking.shipper_id,
      type: 'booking_picked_up',
      title: '🚚 A csomagod úton van!',
      body: `A szállító felvette a csomagodat (${booking.route_title || 'foglalás'}). A címzett a 6 jegyű kóddal veszi át.`,
      link: '/dashboard/foglalasaim',
    }).catch(() => {});
  }

  if (kind === 'dropoff' && booking.status === 'in_progress') {
    // Atomi státusz-átmenet: párhuzamos kérések közül csak az első nyer
    const claim = await db.query(
      `UPDATE route_bookings SET status = 'delivered', delivered_at = NOW()
        WHERE id = $1 AND status = 'in_progress'`,
      [bookingId],
    );
    if (claim.rowCount === 0) {
      return res.status(409).json({ error: 'Ezt a foglalást időközben már lezárták.' });
    }

    // Készpénzes modell: kézbesítéskor nincs pénzmozgás a platformon — a
    // fuvardíjat a szállító készpénzben kapja.
    realtime.emitToUser(booking.shipper_id, 'route-booking:delivered', { booking_id: bookingId, photo });
    realtime.emitToUser(booking.carrier_id, 'route-booking:delivered', { booking_id: bookingId, photo });

    // Értesítések (in-app + SMS) — fire-and-forget
    createNotification({
      user_id: booking.shipper_id,
      type: 'booking_delivered',
      title: '📦 A csomagod megérkezett!',
      body: `A(z) "${booking.route_title || 'foglalás'}" csomagod kézbesítve — az átvételi kód ellenőrizve. Ne feledd, a fuvardíj készpénzben jár a szállítónak.`,
      link: '/dashboard/foglalasaim',
    }).catch(() => {});
    setImmediate(async () => {
      try {
        const { rows: shipperRows } = await db.query(
          `SELECT phone, email, full_name FROM users WHERE id = $1`,
          [booking.shipper_id],
        );
        const shipper = shipperRows[0] || {};
        // SMS-MODELL (2026-07-13): kézbesítésről SMS NINCS — email megy a
        // feladónak (lent) és a címzettnek, ha adott email-címet.
        if (booking.recipient_email) {
          sendEmail({
            to: booking.recipient_email,
            subject: `✅ Csomag átvéve: ${booking.route_title || 'GoFuvar foglalás'}`,
            html: `
              <p>Szia${booking.recipient_name ? ` ${booking.recipient_name}` : ''}!</p>
              <p>A(z) <strong>"${booking.route_title || 'foglalt fuvar'}"</strong> csomag kézbesítése megtörtént — az átvételi kód ellenőrizve.</p>
              <p>Köszönjük, hogy a GoFuvart használtátok!</p>
            `,
          }).catch((e) => console.warn('[email] booking recipient delivered hiba:', e.message));
        }
        if (shipper.email) {
          sendEmail({
            to: shipper.email,
            subject: `✅ Kézbesítve: ${booking.route_title || 'foglalásod'}`,
            html: `
              <p>Szia ${shipper.full_name || 'GoFuvar felhasználó'}!</p>
              <p>A foglalásod csomagja sikeresen kézbesítve — a 6 jegyű átvételi kód ellenőrizve.</p>
              <p style="font-size:20px;font-weight:800;color:#16a34a;margin:16px 0">✅ Kézbesítve</p>
              <p>A fuvardíj készpénzben jár a szállítónak — ha még nem adtad át, kérjük rendezd vele közvetlenül.</p>
              <p>Ha bármi probléma van a csomagoddal, a Foglalásaim oldalon tudsz vitás esetet nyitni.</p>
            `,
          }).catch((e) => console.warn('[email] booking_delivered hiba:', e.message));
        }
      } catch (e) {
        console.warn('[notifications] booking_delivered hiba:', e.message);
      }
    });
  }

  res.status(201).json({ photo, validation: { ok: true } });
});

// GET /route-bookings/:bookingId/photos — csak a foglalás felei láthatják
router.get('/route-bookings/:bookingId/photos', authRequired, async (req, res) => {
  const { rows: bRows } = await db.query(
    `SELECT b.shipper_id, r.carrier_id
       FROM route_bookings b JOIN carrier_routes r ON r.id = b.route_id
      WHERE b.id = $1`,
    [req.params.bookingId],
  );
  const b = bRows[0];
  if (!b) return res.status(404).json({ error: 'Foglalás nem található' });
  const isParty = req.user.sub === b.shipper_id || req.user.sub === b.carrier_id
    || req.user.role === 'admin';
  if (!isParty) return res.status(403).json({ error: 'Nincs jogosultság ehhez a foglaláshoz.' });

  const { rows } = await db.query(
    'SELECT * FROM photos WHERE booking_id = $1 ORDER BY taken_at ASC',
    [req.params.bookingId],
  );
  res.json(rows);
});

// GET /jobs/:jobId/photos
// A fuvar fele (feladó / kijelölt szállító / admin) MINDEN fotót lát. Egy
// kívülálló (pl. licitálni készülő szállító) csak a 'listing' fotókat — ezek
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
