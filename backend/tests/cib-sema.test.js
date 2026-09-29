// =====================================================================
//  CIB EKI — SÉMA (096/097), NAPLÓ-MEGŐRZÉS, EXPORT (2026-09-29, PR-2/A)
//
//  A DB-kényszerek a CIB-állapotgép utolsó védvonala — akkor is fognak, ha
//  egy jövőbeli kódút elfelejt egy feltételt:
//   * cib_state CSAK valódi (nem szimulált) CIB-sorra, 16 jegyű TRID-del,
//     ismert állapottal, legfeljebb 3 zárási kísérlettel kerülhet;
//   * fuvaronként legfeljebb EGY zárási sor (closing/close_unknown/closed_ok)
//     — ez zárja ki a kettős terhelést két párhuzamos kísérletnél (I2);
//   * az egyszer használatos hop-link hash-e egyedi;
//   * a banki napló csak titkosított, méretkorlátos, ismert formájú sort
//     fogad.
//  A napló a publikált 13 hónap után törlődik, KIVÉVE a még nem rendezett
//  (pending / needs_review) kísérletekét — azokhoz a bank kivizsgálásakor
//  kellhet a titkosított szöveg.
// =====================================================================
import {
  describe, it, expect, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const { db, app, createUser, createJob } = require('./helpers');
const retention = require('../src/services/retention');
const dbModul = require('../src/db');

afterEach(() => { vi.restoreAllMocks(); });

let tridSzam = 0;
const trid = () => `80000000${String(Date.now() % 1e6).padStart(6, '0')}${String((tridSzam += 1) % 100).padStart(2, '0')}`;

async function fuvar() {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
  return { felado, szallito, job };
}

async function cibSor(f, tobb = {}) {
  const sor = {
    payment_id: trid(), provider: 'cib', is_simulated: false, cib_state: 'initializing', state: 'pending', ...tobb,
  };
  await db.query(
    `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, currency,
                                   state, provider, is_simulated, cib_state, cib_close_attempts, cib_hop_hash)
     VALUES ($1, $2, $3, $4, 500, 'HUF', $5, $6, $7, $8, $9, $10)`,
    [sor.payment_id, f.job.id, f.felado.id, f.szallito.id, sor.state, sor.provider, sor.is_simulated,
      sor.cib_state, sor.cib_close_attempts || 0, sor.cib_hop_hash || null],
  );
  return sor.payment_id;
}

async function hibakod(fn) {
  try { await fn(); } catch (err) { return err.code; }
  return null;
}

describe('096: payment_sessions CIB-oszlopok és a CHECK-kényszer', () => {
  it('valódi CIB-kísérlet (16 jegyű TRID, nem szimulált) minden állapotban beszúrható', async () => {
    const f = await fuvar();
    for (const all of ['initializing', 'ready', 'redirected', 'authorized', 'failed', 'expired',
      'not_closed', 'abandoned', 'init_failed']) {
      const id = await cibSor(f, { cib_state: all });
      const { rows } = await db.query('SELECT cib_state, cib_close_attempts, cib_query_count FROM payment_sessions WHERE payment_id = $1', [id]);
      expect(rows[0]).toEqual({ cib_state: all, cib_close_attempts: 0, cib_query_count: 0 });
    }
  });

  it('a kényszer: nem-CIB, szimulált, nem 16 jegyű vagy ismeretlen állapotú sor → 23514', async () => {
    const f = await fuvar();
    expect(await hibakod(() => cibSor(f, { provider: 'unknown' }))).toBe('23514');
    expect(await hibakod(() => cibSor(f, { is_simulated: true }))).toBe('23514');
    expect(await hibakod(() => cibSor(f, { payment_id: `cib-stub-${f.job.id}` }))).toBe('23514');
    expect(await hibakod(() => cibSor(f, { payment_id: '123456789012345' }))).toBe('23514');
    expect(await hibakod(() => cibSor(f, { cib_state: 'paid' }))).toBe('23514');
    expect(await hibakod(() => cibSor(f, { cib_close_attempts: 4 }))).toBe('23514');
  });

  it('a meglévő (nem-CIB) sorok érintetlenek: a szimulált stub-session cib_state nélkül él tovább', async () => {
    const f = await fuvar();
    await db.query(
      `INSERT INTO payment_sessions (payment_id, job_id, shipper_id, carrier_id, amount_huf, provider, is_simulated)
       VALUES ($1, $2, $3, $4, 500, 'cib', TRUE)`,
      [`cib-stub-${f.job.id}`, f.job.id, f.felado.id, f.szallito.id],
    );
    const { rows } = await db.query('SELECT cib_state, cib_result FROM payment_sessions WHERE payment_id = $1', [`cib-stub-${f.job.id}`]);
    expect(rows[0]).toEqual({ cib_state: null, cib_result: null });
  });
});

describe('097: indexek', () => {
  it('fuvaronként legfeljebb EGY zárási sor (closing / close_unknown / closed_ok) → 23505', async () => {
    for (const [a, b] of [['closing', 'closed_ok'], ['close_unknown', 'closing'], ['closed_ok', 'closed_ok']]) {
      const f = await fuvar();
      await cibSor(f, { cib_state: a });
      expect(await hibakod(() => cibSor(f, { cib_state: b })), `${a} + ${b}`).toBe('23505');
    }
  });

  it('egy zárás mellett a fuvar más kísérletei (authorized, failed…) megmaradhatnak', async () => {
    const f = await fuvar();
    await cibSor(f, { cib_state: 'closing' });
    await cibSor(f, { cib_state: 'authorized' });
    await cibSor(f, { cib_state: 'failed' });
    const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM payment_sessions WHERE job_id = $1', [f.job.id]);
    expect(rows[0].n).toBe(3);
  });

  it('a hop-link hash egyedi', async () => {
    const f = await fuvar();
    await cibSor(f, { cib_state: 'ready', cib_hop_hash: 'h-egyedi-1' });
    expect(await hibakod(() => cibSor(f, { cib_state: 'ready', cib_hop_hash: 'h-egyedi-1' }))).toBe('23505');
  });

  it('a teendő-, a zárási- és a napló-indexek a várt predikátummal léteznek', async () => {
    const { rows } = await db.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE indexname IN ('payment_sessions_cib_egy_zaras_job', 'payment_sessions_cib_egy_zaras_booking',
                            'payment_sessions_cib_hop', 'payment_sessions_cib_teendo',
                            'cib_messages_payment_idx', 'cib_messages_created_idx')`,
    );
    const def = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(Object.keys(def).sort()).toEqual([
      'cib_messages_created_idx', 'cib_messages_payment_idx', 'payment_sessions_cib_egy_zaras_booking',
      'payment_sessions_cib_egy_zaras_job', 'payment_sessions_cib_hop', 'payment_sessions_cib_teendo',
    ]);
    expect(def.payment_sessions_cib_egy_zaras_job).toMatch(/UNIQUE/);
    expect(def.payment_sessions_cib_egy_zaras_job).toMatch(/closing.*close_unknown.*closed_ok/);
    expect(def.payment_sessions_cib_egy_zaras_booking).toMatch(/UNIQUE/);
    expect(def.payment_sessions_cib_teendo).toMatch(/cib_next_action_at/);
    expect(def.payment_sessions_cib_teendo).toMatch(/pending/);
  });
});

describe('096: cib_messages kényszerei', () => {
  async function naplo(tobb = {}) {
    const s = {
      payment_id: trid(), direction: 'ki', msgt: 10, endpoint: 'market', raw: 'PID=TST0001&CRYPTO=1&DATA=AAAA', ...tobb,
    };
    const { rows } = await db.query(
      `INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, http_status, rc, raw, error_class)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
      [s.payment_id, s.direction, s.msgt, s.endpoint, s.http_status || null, s.rc || null, s.raw, s.error_class || null],
    );
    return rows[0];
  }

  it('érvényes sorok (ki/be/böngésző, TRID nélkül is) beszúrhatók, a created_at az órából jön', async () => {
    const r = await naplo();
    expect(r.created_at).toBeInstanceOf(Date);
    await naplo({ direction: 'be', msgt: 11, http_status: 200, rc: '00' });
    await naplo({ direction: 'be', msgt: null, http_status: 403, rc: 'S01', error_class: 'bank_S', raw: 'RC=S01' });
    await naplo({ direction: 'bongeszo_be', msgt: 21, endpoint: 'vissza', payment_id: null });
    await naplo({ direction: 'be', raw: '', error_class: 'nem_kuldott' });
  });

  for (const [nev, tobb] of [
    ['ismeretlen irány', { direction: 'oda' }],
    ['ismeretlen üzenettípus', { msgt: 12 }],
    ['ismeretlen végpont', { endpoint: 'webhook' }],
    ['nem 16 jegyű TRID', { payment_id: 'cib-stub-x' }],
    ['túl hosszú RC', { rc: 'ABCD' }],
    ['ismeretlen hibaosztály', { error_class: 'valami' }],
    ['4000 karakternél hosszabb nyers szöveg', { raw: 'x'.repeat(4001) }],
  ]) {
    it(`elutasítva: ${nev}`, async () => {
      expect(await hibakod(() => naplo(tobb))).toBe('23514');
    });
  }
});

describe('purgeOldCibMessages: 13 hónap, kivéve a rendezetlen kísérleteket', () => {
  it('a régi, lezárt kísérlet naplója törlődik; a függő / needs_review / friss marad', async () => {
    const f = await fuvar();
    const lezart = await cibSor(f, { cib_state: 'failed', state: 'closed' });
    const fuggo = await cibSor(f, { cib_state: 'redirected' });
    const ellenorzendo = await cibSor(f, { cib_state: 'failed', state: 'needs_review' });
    const regi = "NOW() - interval '14 months'";
    for (const id of [lezart, fuggo, ellenorzendo]) {
      await db.query(
        `INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, created_at)
         VALUES ($1, 'ki', 33, 'market', 'PID=TST0001&CRYPTO=1&DATA=AAAA', ${regi})`, [id],
      );
    }
    await db.query(
      `INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, created_at)
       VALUES ($1, 'ki', 33, 'market', 'friss', NOW() - interval '12 months')`, [lezart],
    );
    await db.query(
      `INSERT INTO cib_messages (payment_id, direction, msgt, endpoint, raw, created_at)
       VALUES (NULL, 'bongeszo_be', 21, 'vissza', 'azonositatlan', ${regi})`,
    );

    const torolt = await retention.purgeOldCibMessages();
    expect(torolt).toBeGreaterThanOrEqual(2);

    const { rows } = await db.query(
      `SELECT payment_id, raw FROM cib_messages
        WHERE payment_id = ANY($1::text[]) OR (payment_id IS NULL AND raw = 'azonositatlan')`,
      [[lezart, fuggo, ellenorzendo]],
    );
    const marad = rows.map((r) => `${r.payment_id}:${r.raw}`);
    expect(marad).toContain(`${lezart}:friss`);
    expect(marad).not.toContain(`${lezart}:PID=TST0001&CRYPTO=1&DATA=AAAA`);
    expect(marad).toContain(`${fuggo}:PID=TST0001&CRYPTO=1&DATA=AAAA`);
    expect(marad).toContain(`${ellenorzendo}:PID=TST0001&CRYPTO=1&DATA=AAAA`);
    expect(marad).not.toContain('null:azonositatlan');
  });

  it('DB-hibánál TOVÁBBDOB (a napi kör riaszt, nem „sikeres 0")', async () => {
    vi.spyOn(dbModul, 'query').mockRejectedValue(new Error('szimulált DB-kiesés'));
    await expect(retention.purgeOldCibMessages()).rejects.toThrow();
  });

  it('a napi kör meghívja', () => {
    const forras = require('fs').readFileSync(require.resolve('../src/services/retention.js'), 'utf8');
    const blokk = forras.match(/const KOR_NEVEK\s*=\s*\[([\s\S]*?)\];/)[1];
    expect(blokk).toContain("'purgeOldCibMessages'");
  });
});

describe('export: a saját CIB-kísérlet állapota és eredménye (bizonyíték és admin-azonosító nélkül)', () => {
  it('a feladó a sajátját látja, a szállító nem', async () => {
    const f = await fuvar();
    const id = await cibSor(f, { cib_state: 'failed', state: 'closed' });
    await db.query(
      `UPDATE payment_sessions SET cib_result = $2::jsonb WHERE payment_id = $1`,
      [id, JSON.stringify({
        rc: '51', rt: 'Nincs fedezet', amo: 500, ok: 'bank_elutasitas', admin_id: 'titkos-admin', bizonyitek: { msgt71_status: '30' },
      })],
    );
    const felado = await request(app).get('/auth/me/export').set('Authorization', `Bearer ${f.felado.token}`);
    expect(felado.status).toBe(200);
    const sajat = felado.body.fizetesi_munkameneteim.find((s) => s.payment_id === id);
    expect(sajat.cib_state).toBe('failed');
    expect(sajat.cib_result).toMatchObject({ rc: '51', rt: 'Nincs fedezet', ok: 'bank_elutasitas' });
    expect(sajat.cib_result.admin_id).toBeUndefined();
    expect(sajat.cib_result.bizonyitek).toBeUndefined();

    const szallito = await request(app).get('/auth/me/export').set('Authorization', `Bearer ${f.szallito.token}`);
    const masik = szallito.body.fizetesi_munkameneteim.find((s) => s.job_id === f.job.id);
    expect(masik.payment_id).toBeNull();
    expect(masik.cib_state).toBeNull();
    expect(masik.cib_result).toBeNull();
  });
});
