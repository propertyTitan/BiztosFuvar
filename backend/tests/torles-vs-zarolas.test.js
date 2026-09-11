// =====================================================================
//  FIÓKTÖRLÉS vs. BIZONYÍTÉK-ZÁROLÁS (2026-09-11, Codex-audit P0-06)
//
//  A photo_retention_hold 5 évig őrzi a vitás ügylet fotóit/chatjét (ÁSZF +
//  tájékoztató), a vita lezárása után is. A törlésvédelem viszont csak az
//  aktív/fizetett/épp vitatott ügyletet nézte: egy LEZÁRT, zárolt ügylet
//  tulajdonosa törölhette a fiókját, és a CASCADE vitte a bizonyítékot. Két
//  ígéret ütközött — a megőrzés nyer (GDPR 17(3)e).
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('Zárolt bizonyíték = a fiók nem törölhető', () => {
  it('self-delete: lezárt, de zárolt fuvar tulajdonosa 409-et kap', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true });
    await db.query('UPDATE jobs SET photo_retention_hold = TRUE WHERE id = $1', [job.id]);
    const res = await request(app).delete('/auth/me').set(auth(shipper.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('USER_HAS_ACTIVE_PAID');
    const { rows } = await db.query('SELECT 1 FROM users WHERE id = $1', [shipper.id]);
    expect(rows.length, 'a fiók törlődött, a zárolt bizonyíték vele').toBe(1);
  });

  it('admin-törlés: a zárolt ügylet másik fele (szállító) sem törölhető', async () => {
    const admin = await createUser({ role: 'admin' });
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true });
    await db.query('UPDATE jobs SET photo_retention_hold = TRUE WHERE id = $1', [job.id]);
    const res = await request(app).delete(`/admin/users/${carrier.id}`).set(auth(admin.token));
    expect(res.status, JSON.stringify(res.body)).toBe(409);
  });

  it('kontroll: lezárt, NEM zárolt fuvar tulajdonosa törölheti a fiókját', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await createJob({ shipperId: shipper.id, carrierId: carrier.id, status: 'delivered', paid: true });
    const res = await request(app).delete('/auth/me').set(auth(shipper.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  });
});
