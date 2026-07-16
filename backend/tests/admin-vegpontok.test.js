// Az admin-turbó új végpontjainak őre (2026-07-17):
//   - GET /admin/messages: CSAK admin olvashatja bármely ügylet chatjét
//     (a felek a saját /messages végpontjukat használják)
//   - POST /admin/users/:id/force-logout: a token_version léptetése a user
//     korábbi JWT-jét ténylegesen érvényteleníti (048-as mechanizmus)
//   - GET /admin/jobs?search=: a szabad-szavas keresés működik
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { app, db, createUser } = require('./helpers');

describe('Admin végpontok (turbó)', () => {
  let admin, shipper, carrier, jobId;

  beforeAll(async () => {
    admin = await createUser({ role: 'admin' });
    shipper = await createUser();
    carrier = await createUser({ role: 'carrier' });
    const { rows } = await db.query(
      `INSERT INTO jobs (shipper_id, carrier_id, title, description,
          pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
          suggested_price_huf, status)
       VALUES ($1,$2,'Admin kereshető fuvar','x','Budapest',47.5,19.0,'Szeged',46.2,20.1,10000,'accepted')
       RETURNING id`,
      [shipper.id, carrier.id],
    );
    jobId = rows[0].id;
    await db.query(
      `INSERT INTO messages (job_id, sender_id, body) VALUES ($1,$2,'admin-teszt üzenet')`,
      [jobId, shipper.id],
    );
  });

  it('GET /admin/messages: admin látja az ügylet chatjét', async () => {
    const res = await request(app)
      .get(`/admin/messages?job_id=${jobId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].body).toBe('admin-teszt üzenet');
    expect(res.body[0].sender_name).toBeTruthy();
  });

  it('GET /admin/messages: NEM admin 403-at kap', async () => {
    const res = await request(app)
      .get(`/admin/messages?job_id=${jobId}`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(res.status).toBe(403);
  });

  it('force-logout: a user korábbi tokenje érvénytelenné válik', async () => {
    // A token még él
    const before = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${carrier.token}`);
    expect(before.status).toBe(200);

    const fl = await request(app)
      .post(`/admin/users/${carrier.id}/force-logout`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(fl.status).toBe(200);

    // A régi token 401 (token_version léptetve)
    const after = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${carrier.token}`);
    expect(after.status).toBe(401);
  });

  it('force-logout: NEM admin nem hívhatja', async () => {
    const res = await request(app)
      .post(`/admin/users/${shipper.id}/force-logout`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(res.status).toBe(403);
  });

  it('GET /admin/jobs?search= a cím ÉS a feladó-email alapján is talál', async () => {
    const byTitle = await request(app)
      .get('/admin/jobs?search=Admin kereshető')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(byTitle.status).toBe(200);
    expect(byTitle.body.some((j) => j.id === jobId)).toBe(true);

    const byEmail = await request(app)
      .get(`/admin/jobs?search=${encodeURIComponent(shipper.email)}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.some((j) => j.id === jobId)).toBe(true);
  });
});
