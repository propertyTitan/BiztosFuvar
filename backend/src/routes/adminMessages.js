// =====================================================================
//  Admin ↔ felhasználó üzenetküldés (2026-08-08, user-döntés).
//
//  Szabályok:
//   - Az admin bárkinek írhat (közvetlen üzenet), és körüzenetet küldhet
//     célzottan (mindenki / feladók / szállítók / céges fiókok).
//   - A felhasználó MAGÁTÓL NEM tud írni az adminnak. A válasz-csatorna
//     csak akkor nyílik meg, ha kapott legalább egy KÖZVETLEN ('direct')
//     admin-üzenetet. A körüzenet SZÁNDÉKOSAN nem nyit csatornát —
//     különben az első körüzenet után minden user írhatna.
//   - Userenként egy szál van az adminnal (admin_messages.user_id).
//
//  Kézbesítés: DB-sor + in-app értesítés (socket + push a
//  createNotification-ből) + opcionális email. A körüzenet emailjei
//  HÁTTÉRBEN, ütemezve mennek ki (Resend rate limit — ~2 kérés/mp).
// =====================================================================

const express = require('express');
const db = require('../db');
const realtime = require('../realtime');
const { authRequired, requireRole } = require('../middleware/auth');
const { writeRateLimit } = require('../middleware/rateLimit');
const { requireText } = require('../utils/text');
const { createNotification } = require('../services/notifications');
const { sendAdminMessageEmail } = require('../services/email');
const { maskEmail } = require('../utils/mask');

const router = express.Router();
const adminOnly = [authRequired, requireRole('admin')];

// A körüzenet cél-szűrői. Admint sosem célzunk (mi magunk vagyunk azok).
//
// ⚠️ 2026-08-08 átvizsgálás-találat: a "carriers" eredetileg `role='carrier'`
// volt — de a web-regisztráció SOSEM ad carrier szerepet (mindenki 'shipper'-
// ként jön létre, és kliens-oldali mód-váltással lesz szállító). A szállítói
// működés valódi jele a `driver_terms_accepted_at` (a szállító-mód első
// használatakor kötelező nyilatkozat). A "shippers" ugyanezért nem a role:
// az, aki TÉNYLEGESEN adott már fel fuvart.
const BROADCAST_TARGETS = {
  all: `role <> 'admin'`,
  shippers: `role <> 'admin' AND EXISTS (SELECT 1 FROM jobs j WHERE j.shipper_id = users.id)`,
  carriers: `role <> 'admin' AND (role = 'carrier' OR driver_terms_accepted_at IS NOT NULL)`,
  company: `account_type = 'company' AND role <> 'admin'`,
};

/**
 * Válaszolhat-e a user az adminnak: kapott-e KÖZVETLEN üzenetet, ÉS a
 * csatornát nem zárta le az admin (admin_channel_closed_at).
 */
async function canUserReply(userId) {
  const { rows } = await db.query(
    `SELECT (u.admin_channel_closed_at IS NULL) AS nyitva,
            EXISTS (SELECT 1 FROM admin_messages m
                     WHERE m.user_id = u.id AND m.kind = 'direct') AS van_direct
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (!rows[0]) return { canReply: false, closed: false };
  return { canReply: rows[0].van_direct && rows[0].nyitva, closed: !rows[0].nyitva };
}

/** Email-küldés az admin-üzenetről — sosem dobhat, a fő tranzakciót nem akasztja. */
function queueMessageEmail({ to, name, bodyText }) {
  setImmediate(() => {
    sendAdminMessageEmail({ to, name, bodyText }).catch(() => {});
  });
}

/**
 * Körüzenet-email hiba a Sentrybe (az sms.js reportSmsFailure mintájára).
 * A háttér-kiküldés fire-and-forget — ha csendben hal el, az admin azt
 * hiszi, mindenki megkapta. A log mellett riasztás is jár.
 */
function reportBroadcastEmailFailure(broadcastId, err, sentCount, totalCount) {
  console.error(`[admin-dm] körüzenet-email hiba (${sentCount}/${totalCount} után):`, err.message);
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = require('@sentry/node');
    Sentry.captureMessage('Körüzenet-email kiküldés megszakadt', {
      level: 'error',
      tags: { broadcast_id: String(broadcastId) },
      extra: { sent: sentCount, total: totalCount, error: err.message },
    });
  } catch (_) {
    // A riasztás hibája sosem érintheti a fő folyamatot.
  }
}

// ===================== ADMIN OLDAL =====================

// GET /admin/dm/threads — szálak listája (utolsó üzenet + olvasatlan válaszok).
// A lista eagerly töltődik az admin-panelen (fül-badge-hez kell a darabszám).
router.get('/admin/dm/threads', ...adminOnly, async (req, res) => {
  const { rows } = await db.query(
    `SELECT m.user_id,
            u.full_name, u.email, u.role,
            MAX(m.created_at) AS last_message_at,
            (ARRAY_AGG(m.body ORDER BY m.created_at DESC))[1] AS last_body,
            (ARRAY_AGG(m.sender ORDER BY m.created_at DESC))[1] AS last_sender,
            COUNT(*) FILTER (WHERE m.sender = 'user' AND m.read_at IS NULL)::int AS unread_count
       FROM admin_messages m
       JOIN users u ON u.id = m.user_id
      GROUP BY m.user_id, u.full_name, u.email, u.role
      ORDER BY MAX(m.created_at) DESC
      LIMIT 200`,
  );
  res.json(rows);
});

// GET /admin/dm/with/:userId — egy szál teljes tartalma.
// Mellékhatás: a user válaszait olvasottra állítja (az admin most látta őket).
router.get('/admin/dm/with/:userId', ...adminOnly, async (req, res) => {
  const { rows: userRows } = await db.query(
    'SELECT id, full_name, email, admin_channel_closed_at FROM users WHERE id = $1',
    [req.params.userId],
  );
  if (!userRows[0]) return res.status(404).json({ error: 'Nincs ilyen felhasználó.' });

  await db.query(
    `UPDATE admin_messages SET read_at = NOW()
      WHERE user_id = $1 AND sender = 'user' AND read_at IS NULL`,
    [req.params.userId],
  );
  const { rows } = await db.query(
    `SELECT m.*, a.full_name AS admin_name
       FROM admin_messages m
       LEFT JOIN users a ON a.id = m.admin_id
      WHERE m.user_id = $1
      ORDER BY m.created_at ASC
      LIMIT 500`,
    [req.params.userId],
  );
  res.json({ user: userRows[0], messages: rows });
});

// POST /admin/dm/with/:userId — közvetlen üzenet egy felhasználónak.
// Body: { body, send_email? } — EZ nyitja meg a user válasz-csatornáját.
router.post('/admin/dm/with/:userId', ...adminOnly, writeRateLimit, async (req, res) => {
  const bodyCheck = requireText(req.body?.body, { label: 'Az üzenet', min: 1, max: 5000 });
  if (!bodyCheck.ok) return res.status(400).json({ error: 'Üres üzenet.' });

  const { rows: userRows } = await db.query(
    'SELECT id, full_name, email, role FROM users WHERE id = $1',
    [req.params.userId],
  );
  const target = userRows[0];
  if (!target) return res.status(404).json({ error: 'Nincs ilyen felhasználó.' });
  // Admin ↔ admin szál értelmetlen (a panel minden admin számára közös).
  if (target.role === 'admin') {
    return res.status(400).json({ error: 'Adminnak nem küldhető üzenet.', code: 'ADMIN_TARGET' });
  }

  const { rows } = await db.query(
    `INSERT INTO admin_messages (user_id, sender, admin_id, kind, body)
     VALUES ($1, 'admin', $2, 'direct', $3)
     RETURNING *`,
    [target.id, req.user.sub, bodyCheck.value],
  );
  const msg = rows[0];

  realtime.emitToUser(target.id, 'admin-dm:new', msg);
  await createNotification({
    user_id: target.id,
    type: 'admin_message',
    title: '📩 Üzenet a GoFuvar csapatától',
    body: bodyCheck.value.slice(0, 100),
    link: '/uzenetek',
  });
  if (req.body?.send_email === true) {
    queueMessageEmail({ to: target.email, name: target.full_name, bodyText: bodyCheck.value });
  }

  res.status(201).json(msg);
});

// POST /admin/dm/broadcast — körüzenet a célzott felhasználóknak.
// Body: { body, target: 'all'|'shippers'|'carriers'|'company', send_email? }
// NEM nyit válasz-csatornát. Az email-példányok háttérben, ütemezve mennek.
router.post('/admin/dm/broadcast', ...adminOnly, writeRateLimit, async (req, res) => {
  const bodyCheck = requireText(req.body?.body, { label: 'Az üzenet', min: 1, max: 5000 });
  if (!bodyCheck.ok) return res.status(400).json({ error: 'Üres üzenet.' });
  const targetWhere = BROADCAST_TARGETS[req.body?.target];
  if (!targetWhere) {
    return res.status(400).json({ error: 'Érvénytelen célcsoport.', code: 'INVALID_TARGET' });
  }
  const sendEmailToo = req.body?.send_email === true;

  const { rows: bcRows } = await db.query(
    `INSERT INTO admin_broadcasts (admin_id, target, body, email_sent)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [req.user.sub, req.body.target, bodyCheck.value, sendEmailToo],
  );
  const broadcastId = bcRows[0].id;

  // Egyetlen INSERT…SELECT szúrja be az összes példányt (nem soronként).
  const { rows: inserted } = await db.query(
    `INSERT INTO admin_messages (user_id, sender, admin_id, kind, broadcast_id, body)
     SELECT id, 'admin', $1, 'broadcast', $2, $3
       FROM users WHERE ${targetWhere}
     RETURNING id, user_id, created_at`,
    [req.user.sub, broadcastId, bodyCheck.value],
  );
  await db.query(
    'UPDATE admin_broadcasts SET recipient_count = $1 WHERE id = $2',
    [inserted.length, broadcastId],
  );

  // In-app értesítés + socket minden címzettnek. A createNotification sosem
  // dob; launch-méretnél (max pár száz user) ez a hurok bőven belefér a
  // kérésbe — ha egyszer tízezres a tábor, batchelendő.
  for (const row of inserted) {
    realtime.emitToUser(row.user_id, 'admin-dm:new', {
      id: row.id, user_id: row.user_id, sender: 'admin', kind: 'broadcast',
      body: bodyCheck.value, created_at: row.created_at,
    });
    await createNotification({
      user_id: row.user_id,
      type: 'admin_broadcast',
      title: '📢 Közlemény a GoFuvartól',
      body: bodyCheck.value.slice(0, 100),
      link: '/uzenetek',
    });
  }

  // Email-példányok HÁTTÉRBEN, ütemezve (Resend limit + a kérés ne várjon).
  // ⚠️ ISMERT KORLÁT: a sor csak memóriában él — ha a folyamat a kiküldés
  // közben újraindul (deploy), a maradék email elveszik. Launch-méretnél
  // (percek alatt végez) ez vállalt kockázat; nagy tábornál perzisztens
  // outbox kell. A megszakadás legalább HANGOS: Sentry-riasztás megy róla.
  if (sendEmailToo && inserted.length > 0) {
    const ids = inserted.map((r) => r.user_id);
    setImmediate(async () => {
      let sent = 0;
      try {
        const { rows: recipients } = await db.query(
          'SELECT email, full_name FROM users WHERE id = ANY($1)',
          [ids],
        );
        for (const r of recipients) {
          await sendAdminMessageEmail({ to: r.email, name: r.full_name, bodyText: bodyCheck.value });
          sent += 1;
          await new Promise((ok) => setTimeout(ok, 600)); // ~100 email/perc
        }
        console.log(`[admin-dm] körüzenet-email kiment: ${recipients.length} címzett`);
      } catch (err) {
        reportBroadcastEmailFailure(broadcastId, err, sent, ids.length);
      }
    });
  }

  console.log(`[admin-dm] körüzenet (${req.body.target}): ${inserted.length} címzett (admin: ${maskEmail(req.user.email || '')})`);
  res.status(201).json({ ok: true, broadcast_id: broadcastId, recipient_count: inserted.length, email_queued: sendEmailToo });
});

// GET /admin/dm/broadcasts — korábbi körüzenetek naplója.
router.get('/admin/dm/broadcasts', ...adminOnly, async (req, res) => {
  const { rows } = await db.query(
    `SELECT b.*, a.full_name AS admin_name
       FROM admin_broadcasts b
       LEFT JOIN users a ON a.id = b.admin_id
      ORDER BY b.created_at DESC
      LIMIT 20`,
  );
  res.json(rows);
});

// PATCH /admin/dm/channel — a user válasz-csatornájának lezárása/megnyitása.
// Body: { user_id, closed: boolean }. Lezárva a user nem írhat (403
// CHANNEL_CLOSED), az admin továbbra is igen; bármikor visszanyitható.
router.patch('/admin/dm/channel', ...adminOnly, async (req, res) => {
  const { user_id, closed } = req.body || {};
  if (typeof closed !== 'boolean' || !user_id) {
    return res.status(400).json({ error: 'Kell: user_id és closed (true/false).' });
  }
  const { rows } = await db.query(
    `UPDATE users SET admin_channel_closed_at = ${closed ? 'NOW()' : 'NULL'}
      WHERE id = $1 RETURNING id, admin_channel_closed_at`,
    [user_id],
  );
  if (!rows[0]) return res.status(404).json({ error: 'Nincs ilyen felhasználó.' });
  console.log(`[admin-dm] csatorna ${closed ? 'LEZÁRVA' : 'megnyitva'}: user ${user_id} (admin: ${req.user.sub})`);
  res.json({ ok: true, user_id: rows[0].id, closed: !!rows[0].admin_channel_closed_at });
});

// ===================== FELHASZNÁLÓI OLDAL =====================

// GET /me/admin-messages — a saját szálam az adminnal + válaszolhatok-e.
// Mellékhatás: az admin üzenetei olvasottra állnak (a user most látta őket),
// ÉS a hozzájuk tartozó harang-értesítések is — különben aki közvetlen
// linkről (pl. emailből) érkezik ide, annak a harang-badge sosem aludna ki
// (2026-08-08 átvizsgálás-találat).
router.get('/me/admin-messages', authRequired, async (req, res) => {
  await db.query(
    `UPDATE admin_messages SET read_at = NOW()
      WHERE user_id = $1 AND sender = 'admin' AND read_at IS NULL`,
    [req.user.sub],
  );
  await db.query(
    `UPDATE notifications SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL
        AND type IN ('admin_message', 'admin_broadcast')`,
    [req.user.sub],
  );
  const { rows } = await db.query(
    `SELECT id, sender, kind, body, created_at, read_at
       FROM admin_messages
      WHERE user_id = $1
      ORDER BY created_at ASC
      LIMIT 500`,
    [req.user.sub],
  );
  const { canReply } = await canUserReply(req.user.sub);
  res.json({ messages: rows, can_reply: canReply });
});

// POST /me/admin-messages — válasz az adminnak.
// CSAK akkor, ha az admin már írt közvetlen üzenetet ÉS nem zárta le a
// csatornát (különben 403) — ez a "maguktól ne tudjanak írni" szabály
// kényszerítése.
router.post('/me/admin-messages', authRequired, writeRateLimit, async (req, res) => {
  const bodyCheck = requireText(req.body?.body, { label: 'Az üzenet', min: 1, max: 5000 });
  if (!bodyCheck.ok) return res.status(400).json({ error: 'Üres üzenet.' });

  const { canReply, closed } = await canUserReply(req.user.sub);
  if (!canReply) {
    return res.status(403).json({
      error: closed
        ? 'Ezt a beszélgetést a GoFuvar csapata lezárta.'
        : 'Válaszolni akkor tudsz, ha a GoFuvar csapata közvetlen üzenetet küldött neked.',
      code: closed ? 'CHANNEL_CLOSED' : 'NO_CHANNEL',
    });
  }

  const { rows } = await db.query(
    `INSERT INTO admin_messages (user_id, sender, kind, body)
     VALUES ($1, 'user', 'user_reply', $2)
     RETURNING *`,
    [req.user.sub, bodyCheck.value],
  );
  const msg = rows[0];

  // Értesítés minden adminnak (a panel közös; jellemzően 1-2 admin van).
  const { rows: admins } = await db.query(`SELECT id FROM users WHERE role = 'admin'`);
  const { rows: senderRows } = await db.query(
    'SELECT full_name, email FROM users WHERE id = $1',
    [req.user.sub],
  );
  const senderName = senderRows[0]?.full_name || senderRows[0]?.email || 'Egy felhasználó';
  for (const a of admins) {
    realtime.emitToUser(a.id, 'admin-dm:new', msg);
    await createNotification({
      user_id: a.id,
      type: 'admin_dm_reply',
      title: `💬 Válasz érkezett – ${senderName}`,
      body: bodyCheck.value.slice(0, 100),
      link: '/admin#uzenetek',
    });
  }

  res.status(201).json(msg);
});

module.exports = router;
