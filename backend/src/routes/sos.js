// =====================================================================
//  SOS vészhelyzet végpontok.
//
//  Bármelyik fél (feladó vagy szállító) egy gombnyomással jelezhet
//  vészhelyzetet. A rendszer logolja a GPS pozíciót, értesíti az
//  admint, és opcionálisan a fuvar másik résztvevőjét is.
// =====================================================================

const express = require('express');
const db = require('../db');
const { authRequired } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');
const { createNotification } = require('../services/notifications');
const { detectContactLeak } = require('../utils/contactGuard');
const realtime = require('../realtime');

const router = express.Router();

// POST /sos — vészjelzés küldése
// =====================================================================
//  A VÉSZJELZÉS KIKAPCSOLVA (2026-08-12, USER-DÖNTÉS)
//
//  ⚠️ MIÉRT: a 10. mérés találata (A4). A `POST /sos` eltárolta a bajba jutott
//  ~1 m pontosságú koordinátáját és a szabad szöveges üzenetét, az admin
//  értesítése pedig azt írta, hogy „a részletek az admin-felületen" —
//  CSAKHOGY ILYEN FELÜLET NINCS. A `sos_events` táblát a teljes kódbázisban
//  csak az adatexport, a purge és a bejelentő saját `GET /sos/mine`-ja
//  olvassa; sem az `admin.js`, sem az admin-oldal nem hivatkozik rá.
//
//  Vagyis vészhelyzeti helyadatot gyűjtöttünk olyan célra, amit a rendszer
//  nem tud teljesíteni (GDPR 5. cikk (1) c — adattakarékosság), miközben a
//  funkció a felhasználó felé azt sugallta, hogy segítség érkezik.
//
//  A tulajdonos döntése: amíg nincs mögötte valódi ügyeleti folyamat, a
//  funkció KI VAN KAPCSOLVA. A towing-mintát követi: a végpontok 503-at
//  adnak, de a kód és a biztonsági tesztek élnek, hogy élesztéskor azonnal
//  ellenőrzött legyen — ne „elrothadó" holt kód.
//
//  ⚠️ ÉLESZTÉS ELŐTT KÖTELEZŐ: (1) admin-felület, ami a bejelentést MEGMUTATJA;
//  (2) az adatkezelési tájékoztató 2. szakaszának visszaigazolása; (3) a
//  30. cikkes nyilvántartás sora; (4) a helyadat pontosságának újragondolása.
// =====================================================================
function sosEnabled() {
  return String(process.env.SOS_ENABLED || '').toLowerCase() === 'true';
}

// ⚠️ AZ ÚTVONAL-ELŐTAG KÖTELEZŐ. Előtag nélkül a middleware MINDEN kérésre
// lefut, ami ezen a routeren áthalad — és mivel a router '/'-ra van
// felcsatolva, az utána mountolt adminRoutes / jobQuestions / driverStats
// végpontjai is 503-at kaptak volna. (Az E2E fogta meg; a towing verziója
// eleve kiírja az előtagot.)
router.use('/sos', (req, res, next) => {
  if (!sosEnabled()) {
    return res.status(503).json({
      error: 'A vészjelzés-funkció jelenleg nem elérhető. Vészhelyzetben hívd a 112-t.',
      code: 'SOS_DISABLED',
    });
  }
  return next();
});

router.post('/sos', authRequired, writeRateLimit, async (req, res) => {
  const { job_id, booking_id, lat, lng, message } = req.body || {};

  // ── (1) ÉRINTETTSÉG (2026-08-09, audit): a hívónak FELE kell legyen a
  // hivatkozott ügyletnek. Eddig bárki küldhetett „vészjelzést" TETSZŐLEGES
  // idegen fuvar azonosítójával — a fuvar feladója pedig megkapta a támadó
  // szövegét „🚨 A partnered segítséget kér!" címmel (in-app + push), és
  // minden admin egy hamis riasztást. Percenként 30 ilyen fért bele: a valódi
  // vészjelzések elvesztek volna a zajban.
  let fizetett = false;
  if (job_id) {
    const { rows: j } = await db.query(
      'SELECT paid_at FROM jobs WHERE id = $1 AND (shipper_id = $2 OR carrier_id = $2)',
      [job_id, req.user.sub],
    );
    if (!j.length) return res.status(403).json({ error: 'Nincs jogosultságod ehhez a fuvarhoz.' });
    fizetett = !!j[0].paid_at;
  }
  if (booking_id) {
    const { rows: b } = await db.query(
      `SELECT rb.paid_at FROM route_bookings rb
         JOIN carrier_routes r ON r.id = rb.route_id
        WHERE rb.id = $1 AND (rb.shipper_id = $2 OR r.carrier_id = $2)`,
      [booking_id, req.user.sub],
    );
    if (!b.length) return res.status(403).json({ error: 'Nincs jogosultságod ehhez a foglaláshoz.' });
    fizetett = !!b[0].paid_at;
  }

  // ── (2) KAPCSOLAT-SZIVÁRGÁS: az SOS-üzenet a MÁSIK FÉLHEZ jut el, és eddig
  // kimaradt a szűrésből (a 10 szűrt csatorna közül ez a 11.). Fizetés előtt
  // egy „Hívj: 06 30…" szövegű ál-vészjelzéssel a díj megkerülhető volt.
  //
  // ⚠️ CSAK FIZETÉS ELŐTT szűrünk (a chat mintája, messages.js). Az első
  // verzió feltétel nélkül szűrt — vagyis egy MÁR KIFIZETETT fuvarnál a
  // „elakadtam, hívj a 06…-on" vészjelzést 400-zal elutasította, és mivel a
  // szűrés az INSERT előtt fut, a vészjelzés NYOMTALANUL elveszett. Egy
  // vészhelyzeti funkciónál ez a lehető legrosszabb hibamód; a telefonszám
  // ekkor már amúgy is jogosan ismert mindkét fél előtt.
  if (!fizetett) {
    const leak = detectContactLeak(message);
    if (leak) return res.status(400).json({ error: leak, code: 'CONTACT_LEAK' });
  }

  const { rows } = await db.query(
    `INSERT INTO sos_events (user_id, job_id, booking_id, lat, lng, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      req.user.sub,
      job_id || null,
      booking_id || null,
      lat || null,
      lng || null,
      message || null,
    ],
  );
  const sos = rows[0];

  // Admin értesítés
  let adminIds = [];
  try {
    const { rows: admins } = await db.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 10`,
    );
    adminIds = admins.map((a) => a.id);
    const { rows: userInfo } = await db.query(
      `SELECT full_name, phone FROM users WHERE id = $1`,
      [req.user.sub],
    );
    // ⚠️ PII-MINIMALIZÁLÁS (2026-08-09, adatvédelmi audit): az értesítés
    // `body`-ja eddig a TELJES NEVET, a TELJES TELEFONSZÁMOT és az 5 tizedes
    // (≈1 m pontosságú) GPS-koordinátát tartalmazta — a `notifications`
    // táblában, ahol addig semmilyen retenció nem volt. Vagyis egy vészhelyzet
    // pontos helye és a bejelentő elérhetősége határidő nélkül megmaradt
    // minden admin értesítés-listájában. A jogosult admin ezeket az
    // admin-felületen látja; az értesítés csak a TÉNYT viszi.
    // (Ugyanez a minta, amit a KYC-értesítéseknél már alkalmaztunk.)
    const keresztnev = String(userInfo[0]?.full_name || '').trim().split(/\s+/)[0] || 'Egy felhasználó';

    for (const admin of admins) {
      await createNotification({
        user_id: admin.id,
        type: 'sos_alert',
        title: '🚨 SOS VÉSZJELZÉS!',
        body: `${keresztnev} segítséget kér. A részletek (elérhetőség, pozíció, üzenet) az admin-felületen.`,
        link: `/admin`,
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('[sos] admin notify hiba:', e.message);
  }

  // Ha van fuvar, értesítsük a másik felet is
  if (job_id) {
    try {
      const { rows: jobRows } = await db.query(
        `SELECT shipper_id, carrier_id, title FROM jobs WHERE id = $1`,
        [job_id],
      );
      const job = jobRows[0];
      if (job) {
        const otherId = job.shipper_id === req.user.sub ? job.carrier_id : job.shipper_id;
        if (otherId) {
          await createNotification({
            user_id: otherId,
            type: 'sos_partner_alert',
            title: '🚨 A partnered segítséget kér!',
            // ⚠️ A SZABAD SZÖVEG NEM MÁSOLÓDIK IDE (2026-08-10): a
            // `sos_events.message` 7 nap után törlődik (ezt ígéri a
            // tájékoztató), a `notifications.body` viszont 6 hónapig él —
            // a másolat túlélte volna az eredetit. A partner a fuvar
            // oldalán látja a részleteket.
            body: `A(z) "${job.title}" fuvarhoz kapcsolódó partnered vészjelzést küldött.${message ? ' Részletek a fuvar oldalán.' : ''}`,
            link: job.shipper_id === req.user.sub
              ? `/sofor/fuvar/${job_id}`
              : `/dashboard/fuvar/${job_id}`,
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('[sos] partner notify hiba:', e.message);
    }
  }

  // ⚠️ CSAK AZ ADMINOKNAK (2026-08-09, audit 2. kör). Az `emitGlobal` →
  // `emitToFeed` váltás kizárta a vendégeket, de a `feed` szoba MINDEN
  // bejelentkezett felhasználót jelent — vagyis idegen szállítók élőben
  // látták, KI nyomott vészjelzést és melyik fuvaron (a user_id-ből a
  // publikus profil megadja a nevet). A web egyébként sem hallgatja ezt az
  // eseményt: tiszta szivárgás volt, haszon nélkül.
  for (const adminId of adminIds) realtime.emitToUser(adminId, 'sos:new', {
    sos_id: sos.id,
    user_id: req.user.sub,
    job_id: job_id || null,
    created_at: sos.created_at,
  });

  res.status(201).json({ ok: true, sos_id: sos.id });
});

// GET /sos/mine — saját SOS események
router.get('/sos/mine', authRequired, async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM sos_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [req.user.sub],
  );
  res.json(rows);
});

module.exports = router;
