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
const { app, db, createUser, createJob } = require('./helpers');

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

// =====================================================================
//  A MÁSIK ROUTERBEN LAKÓ ADMIN-MŰVELETEK (2026-08-12, 10. mérés A5/F2)
//
//  ⚠️ Az első változat `router.use` volt az admin.js-ben, tehát KIZÁRÓLAG az
//  admin.js saját routerére hatott. A vita-lezárás, a körlevél és a
//  moderáció NYOMTALAN maradt — pedig ezek a legterheltebb beavatkozások:
//  a vita-döntés szabad szöveget ír egy személyről, a körlevél MINDEN
//  felhasználót elér.
// =====================================================================
describe('Admin-írás más routerekben is nyomot hagy', () => {
  it('a VITA-LEZÁRÁS naplózódik (PATCH /disputes/:id — nem az admin routerben)', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true,
    });
    const { rows: vita } = await db.query(
      `INSERT INTO disputes (job_id, opened_by, description, status)
       VALUES ($1, $2, 'Sérülten érkezett', 'open') RETURNING id`,
      [job.id, felado.id],
    );

    const res = await request(app)
      .patch(`/disputes/${vita[0].id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ status: 'resolved_no_action', resolution_note: 'Megbeszélve' });
    expect(res.status).toBe(200);

    await new Promise((r) => { setTimeout(r, 200); });
    const { rows } = await db.query(
      `SELECT action FROM admin_access_log
        WHERE admin_id = $1 AND action LIKE 'write:%'`,
      [admin.id],
    );
    expect(
      rows.length,
      'A VITA-LEZÁRÁS nem hagyott nyomot.\n'
      + 'Ez a legterheltebb admin-beavatkozás: szabad szöveget ír egy személyről,\n'
      + 'visszaállítja a fuvar státuszát, és elindítja az 5 éves purge-órát.\n'
      + 'A vita-LISTA megnyitása naplózott volt, a LEZÁRÁSA nem — mert a\n'
      + 'middleware csak az admin.js routerére hatott.',
    ).toBeGreaterThan(0);
  });

  it('a NEM-ADMIN írása nem kerül az admin-naplóba', async () => {
    const felado = await createUser({ role: 'shipper' });
    const { rows: elotte } = await db.query(
      'SELECT count(*)::int AS db FROM admin_access_log',
    );

    await request(app)
      .post('/jobs/')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ title: 'x' }); // hiányos — 400, de a napló amúgy sem kaphatja el

    await new Promise((r) => { setTimeout(r, 150); });
    const { rows: utana } = await db.query(
      'SELECT count(*)::int AS db FROM admin_access_log',
    );
    expect(
      utana[0].db,
      'Egy sima felhasználó írása is az ADMIN-hozzáférési naplóba került — '
      + 'a napló így értelmét veszti.',
    ).toBe(elotte[0].db);
  });
});
