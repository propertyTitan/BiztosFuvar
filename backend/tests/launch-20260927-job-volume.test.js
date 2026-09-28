import { expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob } = require('./helpers');
const auth = user => ['Authorization', `Bearer ${user.token}`];

async function setup() {
  const shipper = await createUser();
  const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
  await db.query('UPDATE jobs SET length_cm=40, width_cm=30, height_cm=20, volume_m3=0.024 WHERE id=$1', [job.id]);
  const edit = body => request(app).patch(`/jobs/${job.id}`).set(...auth(shipper)).send(body).then(r => r);
  const read = async () => (await db.query('SELECT * FROM jobs WHERE id=$1', [job.id])).rows[0];
  return { job, edit, read };
}

it.each([
  [{ length_cm: 200, width_cm: 100, height_cm: 100 }, 2],
  [{ length_cm: 200 }, 0.12],
  [{ width_cm: 100 }, 0.08],
  [{ height_cm: 100 }, 0.12],
  [{ length_cm: 2000, width_cm: 2000, height_cm: 2000 }, 8000],
  [{ length_cm: 145, width_cm: 10, height_cm: 10 }, 0.02],
])('méretszerkesztés után a térfogat is változik: %j → %s m³', async (dimensions, volume) => {
  const p = await setup(), before = await p.read();
  const response = await p.edit(dimensions);
  expect(response.status).toBe(200);
  expect(Number(response.body.volume_m3)).toBe(volume);
  const saved = await p.read();
  expect(Number(saved.volume_m3)).toBe(volume);
  expect(saved.terms_revision).toBe(before.terms_revision + 1);
});

it('két egyidejű részleges méretszerkesztés a végleges méretekből számol', async () => {
  const p = await setup(), blocker = await db.pool.connect();
  let lengthEdit, widthEdit;
  const waitForBlocked = count => vi.waitFor(async () => {
    const { rowCount } = await db.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE jobs SET %'");
    expect(rowCount).toBe(count);
  });
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM jobs WHERE id=$1 FOR UPDATE', [p.job.id]);
    lengthEdit = p.edit({ length_cm: 200 });
    await waitForBlocked(1);
    widthEdit = p.edit({ width_cm: 100 });
    await waitForBlocked(2);
  } finally {
    await blocker.query('COMMIT');
    blocker.release();
  }
  expect((await lengthEdit).status).toBe(200);
  expect((await widthEdit).status).toBe(200);
  const saved = await p.read();
  expect([saved.length_cm, saved.width_cm, saved.height_cm]).toEqual([200, 100, 20]);
  expect(Number(saved.volume_m3)).toBe(0.4);
});

it('hibás méret sem a méreteket, sem a térfogatot nem módosítja', async () => {
  const p = await setup(), before = await p.read();
  expect((await p.edit({ length_cm: 200, width_cm: 0 })).status).toBe(400);
  expect(await p.read()).toEqual(before);
});

it('csak szöveges szerkesztés nem írja át a térfogatot', async () => {
  const p = await setup(), before = await p.read();
  expect((await p.edit({ title: 'Pontosított fuvarcím' })).status).toBe(200);
  expect((await p.read()).volume_m3).toBe(before.volume_m3);
});
