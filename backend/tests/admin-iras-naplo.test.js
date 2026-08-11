// =====================================================================
//  ADMIN-ÍRÁS NAPLÓZÁS (2026-08-11, 9. mérés P1)
//
//  ⚠️ Az admin-hozzáférési napló CSAK az OLVASÁST rögzítette. Az ÍRÁSOKAT —
//  KYC-státusz átírása, szerep-váltás, felhasználó törlése, fuvar-státusz
//  módosítása — semmi nem naplózta. A GDPR 5. cikk (2) szempontjából a
//  MÓDOSÍTÁS legalább annyira számít, mint a megtekintés: a megtekintésnél
//  szigorúbbak voltunk, mint a beavatkozásnál.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const { app, db, createUser } = require('./helpers');

describe('Admin-írás: minden módosítás nyomot hagy', () => {
  it('a szerep átírása naplózódik', async () => {
    const admin = await createUser({ role: 'admin' });
    const user = await createUser({ role: 'shipper' });

    const res = await request(app)
      .patch(`/admin/users/${user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'carrier' });
    expect(res.status).toBe(200);

    await new Promise((r) => { setTimeout(r, 200); });
    const { rows } = await db.query(
      `SELECT action FROM admin_access_log
        WHERE admin_id = $1 AND action LIKE 'write:%'`,
      [admin.id],
    );
    expect(
      rows.length,
      'A szerep-átírás NEM hagyott nyomot.\n'
      + 'Egy vitatott ügyben tudni kell, KI állította át — nem csak azt, ki nézte meg.',
    ).toBeGreaterThan(0);
  });

  it('a SIKERTELEN művelet nem szemeteli a naplót', async () => {
    const admin = await createUser({ role: 'admin' });
    const { rows: elotte } = await db.query(
      `SELECT count(*)::int AS db FROM admin_access_log WHERE admin_id = $1`, [admin.id],
    );

    // Nem létező fuvar → 404
    await request(app)
      .patch('/admin/jobs/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'delivered' });

    await new Promise((r) => { setTimeout(r, 200); });
    const { rows: utana } = await db.query(
      `SELECT count(*)::int AS db FROM admin_access_log WHERE admin_id = $1`, [admin.id],
    );
    expect(
      utana[0].db,
      'A 4xx-es (nem megtörtént) művelet is naplózódott — a napló zajos lesz, '
      + 'és a valódi beavatkozások elvesznek benne.',
    ).toBe(elotte[0].db);
  });
});
