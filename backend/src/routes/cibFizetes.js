// =====================================================================
//  CIB EKI — BÖNGÉSZŐS ÉS ADMIN VÉGPONTOK (2026-09-29, CIB PR-2/B)
//
//  Publikus (IP-limittel, soha nem 500):
//    GET /payments/cib/tovabb/:token  — egyszer használatos átirányító link
//                                       a bank fizetőoldalára (MSGT20)
//    GET /payments/cib/vissza         — a bank visszatérési URL-je (MSGT21);
//                                       a NYERS query-t fejti vissza
//    GET /payments/cib/eredmeny?e=    — aláírt, 24 órás token-kapus eredmény
//                                       (a kötelező banki adatsor, személyes
//                                       adat nélkül)
//  Hitelesített:
//    GET /jobs/:id/fee-payment        — a feladónak (és adminnak)
//  Admin:
//    GET  /payments/admin/cib                       — keresés TrID/ANUM/fuvar szerint
//    GET  /payments/admin/cib/:trid                 — részletek + titkosított banki napló
//    POST /payments/admin/cib/:trid/ujraellenorzes  — a következő lekérdezés esedékessé
//    POST /payments/admin/cib/:trid/rendezes        — kétes kísérlet kézi rendezése
//    POST /payments/admin/cib/:trid/kezi-rendezes   — konfig NÉLKÜL is: könyvelés,
//                                                     lejáratás, visszatérítés (PR-5)
// =====================================================================
const express = require('express');
const db = require('../db');
const { authRequired, requireRole } = require('../middleware/auth');
const { createRateLimit, writeRateLimit, navigaciosTullepesKezelo } = require('../middleware/rateLimit');
const { logAdminAccess } = require('../utils/adminAudit');
const { TRID_RE, cibKonfig } = require('../services/cibProtokoll');
const cibFizetes = require('../services/cibFizetes');

const router = express.Router();

// A böngészős végpontok IP-alapú fékje (a globális 300/perc mellett): a
// hop és a visszatérés banki lekérdezést indíthat — a köz és a bérlet véd
// a bank felé, ez a DB felé.
// ⚠️ 2026-10-03 (PR-5/B): VÉGPONTONKÉNT KÜLÖN VÖDÖR. Eddig a három végpont
// egyetlen 60/perc/IP keretet osztott: közös NAT / mobil-CGNAT mögött néhány
// nyitott, 3 mp-enként kérdező eredményoldal elfogyasztotta, és a 3DS után a
// bankból VISSZATÉRŐ vásárló nyers 429 JSON-t kapott (nincs eredmény-token,
// nincs kötelező banki adatsor), az új fizetés átirányító linkje pedig
// lejárt. A két böngésző-navigációs végpont túllépéskor sem ad JSON-t: 303 a
// web hibaoldalára (a lekérdező kör a kísérletet úgyis lezárja, és e-mail is
// megy).
const hibaOldalra = (kod) => (_req, res) => {
  banki(res);
  return res.status(303).setHeader('Location', cibFizetes.hibaOldalUrl(kod)).end();
};
// A globális (300/perc/IP) limiter ELŐTTÜK fut: túllépéskor ugyanez a 303
// (2026-10-04, a PR-5 1. javítóköre) — az Express útvonalai kis- és
// nagybetűre érzéketlenek, az illesztés is az.
const utvonal = (req) => String(req.path || '').toLowerCase().replace(/\/+$/, '');
navigaciosTullepesKezelo((req) => utvonal(req) === '/payments/cib/vissza', hibaOldalra('azonositas'));
navigaciosTullepesKezelo((req) => utvonal(req).startsWith('/payments/cib/tovabb/'), hibaOldalra('link'));
const cibTovabbLimit = createRateLimit({
  windowMs: 60_000,
  max: 30,
  keyBy: 'ip',
  name: 'cib-tovabb',
  onLimit: hibaOldalra('link'),
});
const cibVisszaLimit = createRateLimit({
  windowMs: 60_000,
  max: 120,
  keyBy: 'ip',
  name: 'cib-vissza',
  onLimit: hibaOldalra('azonositas'),
});
// Az eredményoldal fülenként ~20 kérés/perc: 240/perc egy NAT mögötti
// tucatnyi egyidejű fület is kiszolgál (a banki lekérdezést a TrID-köz fékezi).
const cibEredmenyLimit = createRateLimit({
  windowMs: 60_000,
  max: 240,
  keyBy: 'ip',
  name: 'cib-eredmeny',
  message: 'Túl sok kérés. Kérlek várj egy percet.',
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function banki(res) {
  // A banki link és a visszatérés válasza se cache-be, se Referer-be.
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

router.get('/payments/cib/tovabb/:token', cibTovabbLimit, async (req, res) => {
  banki(res);
  const r = await cibFizetes.hopFelhasznal(req.params.token);
  res.status(r.status).setHeader('Location', r.location);
  return res.end();
});

router.get('/payments/cib/vissza', cibVisszaLimit, async (req, res) => {
  banki(res);
  // A req.query-t SZÁNDÉKOSAN nem használjuk: a query-parser a '+'-t
  // szóközzé alakítaná, és a DATA sérülne. A nyers originalUrl a döntő.
  const r = await cibFizetes.visszateres(req.originalUrl);
  if (r.status === 404) return res.status(404).json({ error: 'Nem található' });
  res.status(r.status).setHeader('Location', r.location);
  return res.end();
});

router.get('/payments/cib/eredmeny', cibEredmenyLimit, async (req, res) => {
  const token = typeof req.query.e === 'string' ? req.query.e : '';
  const r = await cibFizetes.eredmenyAllapot(token);
  if (!r) return res.status(404).json({ error: 'Az eredmény nem található vagy a link lejárt.' });
  return res.json(r);
});

router.get('/jobs/:id/fee-payment', authRequired, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Fuvar nem található' });
  const { rows } = await db.query(
    `SELECT id, shipper_id, carrier_id, status, paid_at, connection_fee_huf, accepted_price_huf, suggested_price_huf
       FROM jobs WHERE id = $1`,
    [req.params.id],
  );
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Fuvar nem található' });
  // A feladó fizetési munkamenete — a szállító soha nem kapja meg.
  if (job.shipper_id !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Csak a fuvar feladója láthatja a díjfizetés állapotát.' });
  }
  return res.json(await cibFizetes.dijFizetesAllapot(job));
});

// ── ADMIN ─────────────────────────────────────────────────────────────
const CIB_ALLAPOTOK = ['initializing', 'ready', 'redirected', 'authorized', 'closing', 'closed_ok',
  'close_unknown', 'failed', 'expired', 'not_closed', 'abandoned', 'init_failed'];

function datum(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

router.get('/payments/admin/cib', authRequired, requireRole('admin'), async (req, res) => {
  await logAdminAccess(req, 'cib_transactions', { type: 'cib' });
  const where = ["ps.provider = 'cib'", 'ps.cib_state IS NOT NULL'];
  const params = [];
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q) {
    if (UUID_RE.test(q)) {
      params.push(q.toLowerCase());
      where.push(`ps.job_id = $${params.length}::uuid`);
    } else if (/^[0-9]{6,16}$/.test(q)) {
      params.push(`%${q}%`, q);
      where.push(`(ps.payment_id LIKE $${params.length - 1} OR ps.cib_result->>'anum' = $${params.length})`);
    } else if (/^[A-Za-z0-9]{1,6}$/.test(q)) {
      params.push(q);
      where.push(`ps.cib_result->>'anum' = $${params.length}`);
    } else {
      return res.status(400).json({ error: 'A keresés TrID (legalább 6 számjegy), ANUM vagy fuvar-azonosító lehet.', code: 'INVALID_VALUE' });
    }
  }
  const allapot = typeof req.query.allapot === 'string' ? req.query.allapot : '';
  if (allapot) {
    if (allapot === 'needs_review') {
      where.push("ps.state = 'needs_review'");
    } else if (cibFizetes.UI_ALLAPOTOK.includes(allapot)) {
      // 2026-10-03 (PR-5/B): a felület szótára — pontosan a lista pillje
      // szerinti tételek (a lekepez SQL-tükre). A webes admin az „ellenorzes"
      // szót küldi (szűrő + „Egyeztetésre vár" jelvény); a többi szűrője a
      // nyers CIB-állapot (web lib/cibAdmin.ts ALLAPOT_SZURO, 2026-10-04).
      params.push(allapot);
      where.push(`${cibFizetes.lekepezSql('ps')} = $${params.length}`);
    } else if (CIB_ALLAPOTOK.includes(allapot)) {
      params.push(allapot);
      where.push(`ps.cib_state = $${params.length}`);
    } else {
      return res.status(400).json({ error: 'Ismeretlen állapot.', code: 'INVALID_VALUE' });
    }
  }
  for (const [kulcs, jel] of [['from', '>='], ['to', '<=']]) {
    if (req.query[kulcs] === undefined || req.query[kulcs] === '') continue;
    const d = datum(req.query[kulcs]);
    if (!d) return res.status(400).json({ error: `Érvénytelen dátum (${kulcs}).`, code: 'INVALID_VALUE' });
    params.push(d);
    where.push(`ps.created_at ${jel} $${params.length}::timestamptz`);
  }
  const limit = Math.min(Math.max(1, Math.floor(Number(req.query.limit)) || 50), 200);
  const offset = Math.min(Math.max(0, Math.floor(Number(req.query.offset)) || 0), 100000);
  const felt = where.join(' AND ');
  const { rows } = await db.query(
    `SELECT ps.payment_id, ps.job_id, ps.state, ps.cib_state, ps.amount_huf, ps.cib_result, ps.created_at,
            COUNT(*) OVER() AS osszes
       FROM payment_sessions ps
      WHERE ${felt}
      ORDER BY ps.created_at DESC, ps.payment_id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  let total = rows[0] ? Number(rows[0].osszes) : 0;
  if (!rows[0] && offset > 0) {
    const { rows: c } = await db.query(`SELECT COUNT(*)::int AS n FROM payment_sessions ps WHERE ${felt}`, params);
    total = c[0].n;
  }
  return res.json({
    items: rows.map((s) => ({
      trid: s.payment_id,
      job_id: s.job_id,
      allapot: cibFizetes.lekepez(s),
      cib_state: s.cib_state,
      amount_huf: Number(s.amount_huf),
      rc: (s.cib_result && s.cib_result.rc) || null,
      anum: (s.cib_result && s.cib_result.anum) || null,
      created_at: s.created_at,
      closed_at: (s.cib_result && s.cib_result.closed_at) || null,
    })),
    total,
  });
});

router.get('/payments/admin/cib/:trid', authRequired, requireRole('admin'), async (req, res) => {
  if (!TRID_RE.test(req.params.trid)) return res.status(404).json({ error: 'Nem található' });
  const { rows } = await db.query(
    `SELECT * FROM payment_sessions WHERE payment_id = $1 AND provider = 'cib' AND cib_state IS NOT NULL`,
    [req.params.trid],
  );
  const s = rows[0];
  if (!s) return res.status(404).json({ error: 'Nem található' });
  await logAdminAccess(req, 'cib_transaction_detail', { type: 'job', id: s.job_id });
  const { rows: events } = await db.query(
    `SELECT status, event_type, processed, total_amount, currency, summary, created_at
       FROM payment_events WHERE payment_id = $1 ORDER BY created_at`,
    [s.payment_id],
  );
  const { rows: messages } = await db.query(
    `SELECT created_at, direction, msgt, endpoint, http_status, rc, error_class, close_attempt, raw
       FROM cib_messages WHERE payment_id = $1 ORDER BY id`,
    [s.payment_id],
  );
  const { cib_hop_hash: _hop, cib_lease_owner: _berlo, ...session } = s;
  return res.json({
    session: { ...session, allapot: cibFizetes.lekepez(s) },
    result: s.cib_result || null,
    events,
    messages,
  });
});

router.post('/payments/admin/cib/:trid/ujraellenorzes', authRequired, requireRole('admin'), writeRateLimit, async (req, res) => {
  if (!TRID_RE.test(req.params.trid)) return res.status(404).json({ error: 'Nem található' });
  if (cibKonfig() !== 'teljes') return res.status(409).json({ error: 'A CIB-konfiguráció nem teljes.', code: 'CIB_UNAVAILABLE' });
  const r = await cibFizetes.ujraellenorzes(req.params.trid);
  if (!r) return res.status(404).json({ error: 'Nem található' });
  // Az admin-írás napló (app-szintű middleware) a TrID-et nem tudja célként
  // rögzíteni (a target_id UUID) — a fuvarhoz kötött, kifejezett sor
  // (2026-09-29, 1. javítókör) teszi visszakereshetővé, ki mozdította.
  if (r.http === 200) await logAdminAccess(req, 'cib_ujraellenorzes', { type: 'job', id: r.jobId });
  return res.status(r.http).json(r.body);
});

router.post('/payments/admin/cib/:trid/rendezes', authRequired, requireRole('admin'), writeRateLimit, async (req, res) => {
  if (!TRID_RE.test(req.params.trid)) return res.status(404).json({ error: 'Nem található' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const r = await cibFizetes.rendezes(req.params.trid, {
    eredmeny: b.eredmeny, indoklas: b.indoklas, anum: b.anum, rt: b.rt,
  }, req.user.sub);
  // Pénzügyi hatású admin-döntés (kontakt-felfedés + könyvelés, vagy a
  // kísérlet lezárása): a fuvarhoz kötve, a döntés irányával naplózzuk
  // (2026-09-29, 1. javítókör — a terv H) pontja). A szabad szöveges
  // indoklás NEM kerül a naplóba, az a cib_result-ban van.
  if (r.http === 200) await logAdminAccess(req, `cib_rendezes:${b.eredmeny}`, { type: 'job', id: r.jobId });
  return res.status(r.http).json(r.body);
});

// 2026-10-03 (PR-5): KONFIG NÉLKÜL IS elérhető kézi műveletek — a
// vészvisszaállás (a CIB_* sorok törlése) után a függő kísérleteket semmi
// más nem zárná le. Banki hívás és MSGT32 egyikben sincs.
router.post('/payments/admin/cib/:trid/kezi-rendezes', authRequired, requireRole('admin'), writeRateLimit, async (req, res) => {
  if (!TRID_RE.test(req.params.trid)) return res.status(404).json({ error: 'Nem található' });
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const r = await cibFizetes.keziRendezes(req.params.trid, {
    muvelet: b.muvelet, indoklas: b.indoklas, banki_hivatkozas: b.banki_hivatkozas,
  }, req.user.sub);
  if (r.http === 200) await logAdminAccess(req, `cib_kezi:${b.muvelet}`, { type: 'job', id: r.jobId });
  return res.status(r.http).json(r.body);
});

module.exports = router;
