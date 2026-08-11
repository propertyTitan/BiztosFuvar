// Dispute (vita / reklamáció) végpontok.
//
// Bármelyik fél nyithat disputot egy fuvarra vagy foglalásra:
//   POST /disputes         — megnyitás (description + opcionális evidence_url)
//   GET  /disputes/mine    — a saját nyitott viták
//   GET  /disputes/:id     — egy vita részletei
//   PATCH /disputes/:id    — admin döntés (resolve)
const express = require('express');
const { logAdminAccess } = require('../utils/adminAudit');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { requireText } = require('../utils/text');
const { detectContactLeak } = require('../utils/contactGuard');
const { createNotification } = require('../services/notifications');
const realtime = require('../realtime');
const { writeRateLimit } = require('../middleware/rateLimit');
const { sendEmail, wrapHtml, formatHuf } = require('../services/email');

const router = express.Router();

// POST /disputes — vita megnyitása
router.post('/disputes', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, description, evidence_url } = req.body || {};

  // ⚠️ A BIZONYÍTÉK-URL VALIDÁLÁSA (2026-08-11, adatvédelmi audit 5. kör).
  // Ez a mező NYERSEN, ellenőrzés nélkül került a DB-be — és 2026-08-09 óta a
  // fájl-törlő gyűjtők is olvassák (userFiles.js: fiók-törlés, admin
  // entitás-törlés, 5 éves vita-purge). A kettő együtt INTEGRITÁS-TÁMADÁS:
  // a támadó a saját fuvarjára nyit vitát, `evidence_url`-nek beállítja egy
  // MÁSIK ember objektum-URL-jét (az avatart bárki megkapja a publikus
  // profilból, az ügylet másik felének fotóit legitim módon látja), majd
  // törli a fiókját → a rendszer a MÁSIK ember fájlját törli az R2-ből.
  // Épp a bizonyíték-rétegen: egy vitás fuvar felvételi fotója tüntethető el.
  //
  // ⚠️ UGYANAZ A HIBAOSZTÁLY, mint az avatar_url-nél (PR #151) — csak ott
  // kijavítottam, itt nem néztem meg, HOLOTT ugyanabban a PR-ben (#144) én
  // tettem be az evidence_url-t a törlő gyűjtőbe. Szabadon írható mezőre nem
  // szabad visszafordíthatatlan műveletet alapozni.
  //
  // A `private:` prefix a KYC privát bucketre mutat — kliensről SOHA nem
  // fogadható el. A publikus URL-t is csak a SAJÁT tárolónkra engedjük.
  // ⚠️ A PREFIX-ELLENŐRZÉS NEM VOLT ELÉG (2026-08-11, 7. mérés). Az első
  // javítás azt követelte, hogy az URL a SAJÁT bucketünkkel kezdődjön —
  // csakhogy az avatar, a hirdetés-fotó és a fuvar-fotó MIND ugyanazt a
  // prefixet kapja (storage.js), és a `deleteFile` bármit töröl, ami így
  // kezdődik. Vagyis a támadó a saját fuvarjára nyitott vitába beírhatta egy
  // MÁSIK ember avatar-URL-jét (a publikus profilról bárki megkapja) vagy egy
  // vitás fuvar felvételi fotóját, és a fiók-törlés / admin-törlés / 5 éves
  // vita-purge elvitte az áldozat fájlját. Épp a bizonyíték-rétegen.
  //
  // A helyes ellenőrzés nem az URL ALAKJA, hanem a TULAJDONJOG: a hivatkozott
  // fotónak ahhoz a fuvarhoz/foglaláshoz kell tartoznia, amire a vita szól.
  let tisztaEvidence = null;
  if (evidence_url != null && evidence_url !== '') {
    const ertek = String(evidence_url);
    const { rows: sajatFoto } = await db.query(
      `SELECT 1 FROM photos
        WHERE url = $1
          AND ($2::uuid IS NULL OR job_id = $2)
          AND ($3::uuid IS NULL OR booking_id = $3)
        LIMIT 1`,
      [ertek, job_id || null, booking_id || null],
    );
    if (ertek.length > 500 || sajatFoto.length === 0) {
      return res.status(400).json({
        error: 'A csatolt bizonyítéknak ehhez a fuvarhoz feltöltött fotónak kell lennie. '
          + 'Tölts fel fotót a fuvar oldalán, és azt csatold.',
        code: 'INVALID_EVIDENCE_URL',
      });
    }
    tisztaEvidence = ertek;
  }

  // requireText: nem-string érték (szám, tömb, objektum) korábban 500-zal
  // szállt el a .trim()-en — most rendes 400-at kap a kliens.
  const descriptionCheck = requireText(description, { label: 'A vita leírása', min: 1, max: 5000 });
  if (!descriptionCheck.ok) {
    return res.status(400).json({ error: descriptionCheck.error });
  }
  if (!job_id && !booking_id) {
    return res.status(400).json({ error: 'Adj meg egy fuvar (job_id) vagy foglalás (booking_id) azonosítót.' });
  }

  // Jogosultság: a vitát csak az érintett felek nyithatják
  let againstUser = null;
  let entityPaidAt = null;
  if (job_id) {
    const { rows } = await db.query(
      'SELECT shipper_id, carrier_id, paid_at FROM jobs WHERE id = $1',
      [job_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Fuvar nem található' });
    const j = rows[0];
    if (j.shipper_id !== req.user.sub && j.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Nincs jogosultságod vitát nyitni ezen a fuvaron.' });
    }
    againstUser = j.shipper_id === req.user.sub ? j.carrier_id : j.shipper_id;
    entityPaidAt = j.paid_at;
  }
  if (booking_id) {
    const { rows } = await db.query(
      `SELECT b.shipper_id, b.paid_at, r.carrier_id
         FROM route_bookings b
         JOIN carrier_routes r ON r.id = b.route_id
        WHERE b.id = $1`,
      [booking_id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Foglalás nem található' });
    const b = rows[0];
    if (b.shipper_id !== req.user.sub && b.carrier_id !== req.user.sub) {
      return res.status(403).json({ error: 'Nincs jogosultságod vitát nyitni ezen a foglaláson.' });
    }
    againstUser = b.shipper_id === req.user.sub ? b.carrier_id : b.shipper_id;
    entityPaidAt = b.paid_at;
  }

  // Kapcsolat-szivárgás szűrés a vita-leíráson — CSAK a díjfizetés ELŐTT
  // (2026-08-09, 2. audit-kör F2). A leírás eljut a másik félhez (értesítés +
  // GET /disputes/:id), így fizetés előtt díj-megkerülési csatorna lenne.
  // Fizetés UTÁN a felek jogosan ismerik egymást, és egy telefonszám a
  // leírásban legitim bizonyíték („hívtam a ...számon, nem vette fel") —
  // ugyanaz az elv, mint a chat-szűrésnél.
  if (!entityPaidAt) {
    const leak = detectContactLeak(descriptionCheck.value);
    if (leak) return res.status(400).json({ error: leak, code: 'CONTACT_LEAK' });
  }

  // Duplázat-ellenőrzés: ne lehessen ugyanarra az entitásra kétszer nyitni
  const existingCheck = job_id
    ? await db.query(
        `SELECT id FROM disputes WHERE job_id = $1 AND status NOT IN ('resolved_refund','resolved_no_action','resolved_partial','closed')`,
        [job_id],
      )
    : await db.query(
        `SELECT id FROM disputes WHERE booking_id = $1 AND status NOT IN ('resolved_refund','resolved_no_action','resolved_partial','closed')`,
        [booking_id],
      );
  if (existingCheck.rows.length > 0) {
    return res.status(409).json({
      error: 'Erre az entitásra már van nyitott vita. Várd meg az admin döntését.',
      existing_dispute_id: existingCheck.rows[0].id,
    });
  }

  const { rows: inserted } = await db.query(
    `INSERT INTO disputes (job_id, booking_id, opened_by, against_user, description, evidence_url)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [job_id || null, booking_id || null, req.user.sub, againstUser, descriptionCheck.value, tisztaEvidence],
  );
  const dispute = inserted[0];

  // Ha a fuvar/booking státuszát is "disputed"-re állítjuk.
  // photo_retention_hold: vitás ügylet fotói 5 évig maradnak (a flag a
  // vita lezárása UTÁN is bekapcsolva marad — bizonyíték a Ptk-s
  // igényérvényesítéshez; photoRetention.js törli 5 év után).
  // A vita ELŐTTI státuszt eltesszük, hogy a lezárásakor vissza tudjunk
  // állni rá (053-as migráció). Enélkül a `disputed` egyirányú utca volt.
  // A `status <> 'disputed'` feltétel véd a felülírástól, ha valamiért
  // mégis kétszer futna le.
  if (job_id) {
    await db.query(
      `UPDATE jobs
          SET status_before_dispute = CASE WHEN status <> 'disputed' THEN status ELSE status_before_dispute END,
              status = 'disputed',
              photo_retention_hold = TRUE,
              updated_at = NOW()
        WHERE id = $1`,
      [job_id],
    );
  }
  if (booking_id) {
    await db.query(
      `UPDATE route_bookings
          SET status_before_dispute = CASE WHEN status <> 'disputed' THEN status ELSE status_before_dispute END,
              status = 'disputed',
              photo_retention_hold = TRUE
        WHERE id = $1`,
      [booking_id],
    );
  }

  // Értesítés a másik félnek
  if (againstUser) {
    try {
      const { rows: opener } = await db.query(
        'SELECT full_name FROM users WHERE id = $1',
        [req.user.sub],
      );
      await createNotification({
        user_id: againstUser,
        type: 'dispute_opened',
        title: '⚖️ Vitás eset megnyitva',
        body: `${opener[0]?.full_name || 'Egy felhasználó'} vitát indított: "${description.slice(0, 80)}${description.length > 80 ? '…' : ''}"`,
        link: `/ertesitesek`,
      });
    } catch (e) {
      console.warn('[notifications] dispute_opened hiba:', e.message);
    }
  }

  res.status(201).json(dispute);
});

// GET /disputes — ÖSSZES vita (csak admin). Az admin felület vita-listája
// ezt használja; a /disputes/mine csak a saját érintettségű vitákat adja,
// ami adminnak jellemzően üres volt — emiatt nem látszottak a viták.
router.get('/disputes', authRequired, async (req, res) => {
  // Admin-lista: 200 vita szabad szöveges leírása — a rendszer egyik
  // legterheltebb szövege (kit mivel vádolnak). Naplózandó hozzáférés.
  if (req.user?.role === 'admin') {
    await logAdminAccess(req, 'disputes_list', { type: 'all' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak admin' });
  }
  const { rows } = await db.query(
    `SELECT d.*,
            j.title AS job_title,
            r.title AS route_title,
            opener.full_name AS opened_by_name,
            against.full_name AS against_name
       FROM disputes d
  LEFT JOIN jobs j ON j.id = d.job_id
  LEFT JOIN route_bookings rb ON rb.id = d.booking_id
  LEFT JOIN carrier_routes r ON r.id = rb.route_id
  LEFT JOIN users opener ON opener.id = d.opened_by
  LEFT JOIN users against ON against.id = d.against_user
      ORDER BY (d.status = 'open') DESC, d.created_at DESC
      LIMIT 200`,
  );
  res.json(rows);
});

// GET /disputes/mine — a saját nyitott viták
router.get('/disputes/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*,
            j.title AS job_title,
            r.title AS route_title,
            u.full_name AS against_name
       FROM disputes d
  LEFT JOIN jobs j ON j.id = d.job_id
  LEFT JOIN route_bookings rb ON rb.id = d.booking_id
  LEFT JOIN carrier_routes r ON r.id = rb.route_id
  LEFT JOIN users u ON u.id = d.against_user
      WHERE d.opened_by = $1 OR d.against_user = $1
      ORDER BY d.created_at DESC`,
    [req.user.sub],
  );
  res.json(rows);
});

// GET /disputes/:id
router.get('/disputes/:id', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT d.*,
            j.title AS job_title,
            r.title AS route_title,
            opener.full_name AS opened_by_name,
            against.full_name AS against_name
       FROM disputes d
  LEFT JOIN jobs j ON j.id = d.job_id
  LEFT JOIN route_bookings rb ON rb.id = d.booking_id
  LEFT JOIN carrier_routes r ON r.id = rb.route_id
  LEFT JOIN users opener ON opener.id = d.opened_by
  LEFT JOIN users against ON against.id = d.against_user
      WHERE d.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vita nem található' });
  const d = rows[0];
  // Jogosultság: érintett felek + admin
  if (d.opened_by !== req.user.sub && d.against_user !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nincs jogosultság' });
  }
  res.json(d);
});

// PATCH /disputes/:id — admin döntés
// body: { status, resolution_note, refund_huf }
router.patch('/disputes/:id', authRequired, writeRateLimit, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak admin oldhatja meg a vitákat.' });
  }
  const { status, resolution_note, refund_huf } = req.body || {};
  const allowed = ['under_review', 'resolved_refund', 'resolved_no_action', 'resolved_partial', 'closed'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Érvénytelen státusz' });
  }

  const isResolved = status.startsWith('resolved_') || status === 'closed';
  const { rows } = await db.query(
    `UPDATE disputes
        SET status = $1,
            resolution_note = COALESCE($2, resolution_note),
            refund_huf = COALESCE($3, refund_huf),
            resolved_by = CASE WHEN $4 THEN $5 ELSE resolved_by END,
            resolved_at = CASE WHEN $4 THEN NOW() ELSE resolved_at END,
            updated_at = NOW()
      WHERE id = $6
    RETURNING *`,
    [status, resolution_note || null, refund_huf || 0, isResolved, req.user.sub, req.params.id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Vita nem található' });
  const d = rows[0];

  // A VITA LEZÁRÁSAKOR visszaállítjuk a fuvar/foglalás státuszát arra, ami a
  // vita előtt volt (053-as migráció). Korábban ez elmaradt, és a fuvar
  // örökre 'disputed' maradt — akkor is, ha az admin úgy döntött, nincs
  // teendő. A `photo_retention_hold` SZÁNDÉKOSAN bekapcsolva marad: a vitás
  // ügylet fotói a lezárás után is 5 évig kellenek (Ptk-s igényérvényesítés).
  if (isResolved) {
    if (d.job_id) {
      await db.query(
        `UPDATE jobs
            SET status = COALESCE(status_before_dispute, status),
                status_before_dispute = NULL,
                updated_at = NOW()
          WHERE id = $1 AND status = 'disputed'`,
        [d.job_id],
      );
    }
    if (d.booking_id) {
      await db.query(
        `UPDATE route_bookings
            SET status = COALESCE(status_before_dispute, status),
                status_before_dispute = NULL
          WHERE id = $1 AND status = 'disputed'`,
        [d.booking_id],
      );
    }
  }

  // Notifikáció mindkét félnek
  const users = [d.opened_by, d.against_user].filter(Boolean);
  for (const uid of users) {
    try {
      await createNotification({
        user_id: uid,
        type: isResolved ? 'dispute_resolved' : 'dispute_updated',
        title: isResolved ? '⚖️ Vitás eset lezárva' : '⚖️ Vitás eset frissítve',
        body: resolution_note
          ? `Admin döntés: ${resolution_note.slice(0, 120)}`
          : `A vita státusza: ${status}`,
        link: `/ertesitesek`,
      });
    } catch {}
  }

  res.json(d);
});

module.exports = router;
