import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const fs = require('fs');
const path = require('path');
const { app, db, createUser, createJob, createBooking } = require('./helpers');
const { konyvelDijFizetes } = require('../src/services/feePayment');
const auth = u => ['Authorization', `Bearer ${u.token}`];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function deal(type = 'job') {
  const shipper = await createUser();
  const carrier = await createUser({ role: 'carrier' });
  let entity;
  if (type === 'job') {
    entity = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const bid = await request(app).post(`/jobs/${entity.id}/bids`).set(...auth(carrier))
      .send({ amount_huf: 20000, return_policy: 'included' });
    expect(bid.status).toBe(201);
    const accepted = await request(app).post(`/bids/${bid.body.id}/accept`).set(...auth(shipper))
      .send({ expected_revision: bid.body.revision, expected_amount_huf: bid.body.amount_huf });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  } else {
    entity = (await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'pending' })).booking;
    const confirmed = await request(app).post(`/route-bookings/${entity.id}/confirm`).set(...auth(carrier)).send({});
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  }
  const table = type === 'job' ? 'jobs' : 'route_bookings';
  const column = type === 'job' ? 'job_id' : 'booking_id';
  const url = `/${type === 'job' ? 'jobs' : 'route-bookings'}/${entity.id}`;
  const sessions = async () => (await db.query(`SELECT * FROM payment_sessions WHERE ${column} = $1 ORDER BY payment_id`, [entity.id])).rows;
  const current = async () => (await db.query(`SELECT * FROM ${table} WHERE id = $1`, [entity.id])).rows[0];
  const cancel = (who = shipper) => request(app).post(`${url}/cancel`).set(...auth(who)).send({ reason: 'Már nincs szükség a szállításra.' });
  return { type, entity, table, column, url, shipper, carrier, sessions, current, cancel };
}

it.each([
  ['job', 'cib', 'shipper'], ['job', 'qvik', 'shipper'],
  ['booking', 'cib', 'shipper'], ['booking', 'qvik', 'shipper'],
  ['booking', 'cib', 'carrier'], ['booking', 'qvik', 'carrier'],
])('%s / %s / %s: fizetés nélküli lemondás után mindkét fiók törölhető', async (type, provider, role) => {
  vi.stubEnv('PAYMENT_PROVIDER', provider);
  const d = await deal(type);
  expect(await d.sessions()).toEqual([expect.objectContaining({ state: 'pending', is_simulated: true, provider })]);
  vi.stubEnv('PAYMENT_PROVIDER', provider === 'cib' ? 'qvik' : 'cib');
  expect((await d.cancel(d[role])).status).toBe(200);
  expect(await d.current()).toMatchObject({ status: 'cancelled', paid_at: null });
  expect(await d.sessions()).toEqual([expect.objectContaining({ state: 'closed', closed_reason: 'cancelled', provider })]);
  expect((await db.query(`SELECT 1 FROM fee_payment_receipts WHERE ${d.column} = $1`, [d.entity.id])).rows).toHaveLength(0);
  expect((await db.query(`SELECT 1 FROM payment_events WHERE ${d.column} = $1`, [d.entity.id])).rows).toHaveLength(0);
  for (const user of [d.shipper, d.carrier]) expect((await request(app).delete('/auth/me').set(...auth(user))).status).toBe(200);
});

it.each(['job', 'booking'])('%s: a valódi/ismeretlen fizetés a régi stub mellett is megőrzi a törlési védelmet', async type => {
  const d = await deal(type);
  const bankId = `qvik-stub-${d.entity.id}`; // A prefix önmagában nem bizonyít szimulációt.
  if (type === 'job') {
    await db.query('UPDATE escrow_transactions SET barion_payment_id = $1, barion_gateway_url = $2 WHERE job_id = $3',
      [bankId, 'https://bank.example/pay', d.entity.id]);
  } else {
    await db.query('UPDATE route_bookings SET barion_payment_id = $1, barion_gateway_url = $2 WHERE id = $3',
      [bankId, 'https://bank.example/pay', d.entity.id]);
  }
  expect((await d.cancel()).status).toBe(200);
  expect(await d.sessions()).toEqual([
    expect.objectContaining({ is_simulated: true, state: 'closed', closed_reason: 'cancelled' }),
    expect.objectContaining({ payment_id: bankId, is_simulated: false, state: 'pending', closed_reason: null }),
  ]);
  for (const user of [d.shipper, d.carrier]) expect((await request(app).delete('/auth/me').set(...auth(user))).status).toBe(409);
});

it.each(['job', 'booking'])('%s: a már kifizetett díj és nyugtája megmarad lemondáskor', async type => {
  const d = await deal(type);
  expect((await request(app).post(`${d.url}/pay`).set(...auth(d.shipper)).send({ consent: true })).status).toBe(200);
  expect((await request(app).post(`${d.url}/confirm-payment`).set(...auth(d.shipper)).send({})).status).toBe(200);
  const [session] = await d.sessions();
  expect(session.state).toBe('succeeded');
  expect((await d.cancel()).status).toBe(200);
  expect(await d.sessions()).toEqual([session]);
  expect((await d.current()).paid_at).not.toBeNull();
  expect((await db.query('SELECT 1 FROM fee_payment_receipts WHERE payment_id = $1', [session.payment_id])).rows).toHaveLength(1);
});

it.each(['job', 'booking'])('%s: a még feldolgozatlan sikeres fizetési jelzés nem zárható le lemondásként', async type => {
  const d = await deal(type);
  const [session] = await d.sessions();
  await db.query("INSERT INTO payment_events(payment_id, status, event_type, processed) VALUES ($1, 'Succeeded', 'webhook', false)", [session.payment_id]);
  expect((await d.cancel()).status).toBe(200);
  expect(await d.sessions()).toEqual([session]);
  expect((await request(app).delete('/auth/me').set(...auth(d.shipper))).status).toBe(409);
});

it.each(['job', 'booking'])('%s: a fizetési session lezárási hibája a lemondást is visszagörgeti', async type => {
  const d = await deal(type);
  await db.query(`CREATE FUNCTION fail_cancel_session() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'cancel session failure'; END $$`);
  await db.query(`CREATE TRIGGER fail_cancel_session BEFORE UPDATE ON payment_sessions
    FOR EACH ROW WHEN (OLD.${d.column} = '${d.entity.id}'::uuid AND NEW.state = 'closed') EXECUTE FUNCTION fail_cancel_session()`);
  try {
    expect((await d.cancel()).status).toBe(500);
    expect(await d.current()).toMatchObject({ status: type === 'job' ? 'accepted' : 'confirmed', cancelled_at: null });
    expect((await d.sessions())[0].state).toBe('pending');
  } finally { await db.query('DROP FUNCTION fail_cancel_session() CASCADE'); }
  expect((await d.cancel()).status).toBe(200);
  expect((await d.sessions())[0].state).toBe('closed');
});

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const waitForRowLock = table => vi.waitFor(async () => {
  const waiting = await db.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1", [`UPDATE ${table}%`]);
  expect(waiting.rows.length).toBeGreaterThan(0);
});
async function bookFee(d) {
  const [session] = await d.sessions();
  return konyvelDijFizetes({ entityType: d.type, entityId: d.entity.id, paymentId: session.payment_id,
    eventType: 'manual', feeHuf: session.amount_huf, shipperId: d.shipper.id, carrierId: d.carrier.id });
}

it.each(['job', 'booking'])('%s: az előbb zároló lemondást a párhuzamos könyvelés nem írja felül', async type => {
  const d = await deal(type);
  const client = await db.pool.connect();
  let payment;
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE ${d.table} SET status = 'cancelled' WHERE id = $1`, [d.entity.id]);
    payment = bookFee(d);
    await waitForRowLock(d.table);
    await client.query('COMMIT');
  } finally { await client.query('ROLLBACK'); client.release(); }
  expect((await payment).konyvelve).toBe(0);
  expect(await d.current()).toMatchObject({ status: 'cancelled', paid_at: null });
  expect((await d.sessions())[0]).toMatchObject({ state: 'closed', closed_reason: 'cancelled' });
  expect((await db.query(`SELECT 1 FROM fee_payment_receipts WHERE ${d.column} = $1`, [d.entity.id])).rows).toHaveLength(0);
});

it.each(['job', 'booking'])('%s: az előbb zároló fizetés után a párhuzamos lemondás megőrzi a pénzügyi nyomot', async type => {
  const d = await deal(type);
  const locked = gate(); const release = gate();
  const connect = db.pool.connect.bind(db.pool);
  let paused = false;
  vi.spyOn(db.pool, 'connect').mockImplementation((...args) => {
    if (args.length) return connect(...args);
    return (async () => {
      const client = await connect();
      const query = client.query.bind(client); const originalRelease = client.release.bind(client);
      client.query = async (sql, ...params) => {
        const result = await query(sql, ...params);
        if (!paused && String(sql).startsWith(`UPDATE ${d.table} SET paid_at`) && params[0]?.[0] === d.entity.id) {
          paused = true; locked.resolve(); await release.promise;
        }
        return result;
      };
      client.release = (...releaseArgs) => { client.query = query; client.release = originalRelease; return originalRelease(...releaseArgs); };
      return client;
    })();
  });
  const payment = bookFee(d);
  await locked.promise;
  const cancelled = d.cancel().then(r => r);
  try { await waitForRowLock(d.table); } finally { release.resolve(); }
  expect((await payment).konyvelve).toBe(1);
  expect((await cancelled).status).toBe(200);
  expect((await d.current()).paid_at).not.toBeNull();
  expect((await d.sessions())[0]).toMatchObject({ state: 'succeeded', closed_reason: null });
  expect((await db.query(`SELECT 1 FROM fee_payment_receipts WHERE ${d.column} = $1`, [d.entity.id])).rows).toHaveLength(1);
});

it.each(['job', 'booking'])('%s: a történeti migráció csak a bizonyított, fizetetlen szimulációt zárja, ismétléskor is', async type => {
  const fixtures = [];
  for (const kind of ['cancelled', 'active', 'unknown', 'paid', 'success_signal', 'receipt', 'needs_review']) {
    const d = await deal(type);
    if (kind !== 'active') expect((await d.cancel()).status).toBe(200);
    // Régi, a trigger telepítése előtti beragadt állapotot állítunk elő.
    await db.query(`UPDATE payment_sessions SET state = $1, closed_reason = NULL, settled_at = NULL,
      is_simulated = $2 WHERE ${d.column} = $3`, [kind === 'needs_review' ? 'needs_review' : 'pending', kind !== 'unknown', d.entity.id]);
    const [session] = await d.sessions();
    if (kind === 'paid') await db.query(`UPDATE ${d.table} SET paid_at = NOW() WHERE id = $1`, [d.entity.id]);
    if (kind === 'success_signal') await db.query("INSERT INTO payment_events(payment_id, status, event_type, processed) VALUES ($1, 'Succeeded', 'webhook', false)", [session.payment_id]);
    if (kind === 'receipt') await db.query(`INSERT INTO fee_payment_receipts(payment_id, ${d.column}, shipper_id, fee_huf, paid_at)
      VALUES ($1, $2, $3, $4, NOW())`, [session.payment_id, d.entity.id, d.shipper.id, session.amount_huf]);
    fixtures.push({ d, kind, session });
  }
  const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/090_cancelled_simulated_sessions.sql'), 'utf8');
  await db.query(migration);
  const first = [];
  for (const { d, kind, session } of fixtures) {
    const [actual] = await d.sessions();
    if (kind === 'cancelled') expect(actual).toMatchObject({ state: 'closed', closed_reason: 'cancelled' });
    else expect(actual).toEqual(session);
    first.push(actual);
  }
  await db.query(migration);
  for (let i = 0; i < fixtures.length; i++) expect((await fixtures[i].d.sessions())[0]).toEqual(first[i]);
});

it('a függő foglalás elutasítása is lezárja a megmaradt teszt-sessiont', async () => {
  const d = await deal('booking');
  await db.query("UPDATE route_bookings SET status = 'pending' WHERE id = $1", [d.entity.id]);
  expect((await request(app).post(`${d.url}/reject`).set(...auth(d.carrier)).send({})).status).toBe(200);
  expect((await d.sessions())[0]).toMatchObject({ state: 'closed', closed_reason: 'cancelled' });
});
