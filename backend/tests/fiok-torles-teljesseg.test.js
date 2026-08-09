// =====================================================================
//  A FIÓK-TÖRLÉS (GDPR 17. cikk) TÉNYLEG VÉGIGMEGY
//
//  Audit-találat (2026-08-09, KRITIKUS). A `job_questions.asker_id` egyszerre
//  volt `NOT NULL` és `ON DELETE SET NULL` — önellentmondás: a Postgres a
//  user törlésekor NULL-t próbált írni egy NOT NULL oszlopba (23502), így a
//  `DELETE FROM users` ABORTÁLT. Aki tehát valaha kérdést tett fel MÁS
//  fuvarára, annál a törlés „Szerverhibával" elszállt — MIKÖZBEN a folyamat
//  addigra már VÉGLEGESEN letörölte a tárolóból a személyi igazolvány
//  fotóját, az avatart és a fuvar-fotókat. Kettős kár: a törlési jog nem
//  teljesült, és közben elveszett a vitarendezési fotó-bizonyíték.
//
//  A javítás két része: (1) 058-as migráció — DROP NOT NULL; (2) a törlés
//  tranzakcióban fut, és a visszafordíthatatlan fájl-törlés CSAK a sikeres
//  DB-törlés UTÁN.
// =====================================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const storage = require('../src/services/storage');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });
afterEach(() => { vi.restoreAllMocks(); });

const torol = (token) => request(app).delete('/auth/me').set('Authorization', `Bearer ${token}`);
const letezik = async (id) => (await db.query('SELECT 1 FROM users WHERE id = $1', [id])).rowCount > 0;

describe('Fiók-törlés: a kérdést feltett felhasználó is törölhető', () => {
  it('MÁS fuvarára feltett kérdés nem akasztja meg a törlést', async () => {
    const felado = await createUser({ role: 'shipper' });
    const kerdezo = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });

    const kerdes = await request(app)
      .post(`/jobs/${job.id}/questions`)
      .set('Authorization', `Bearer ${kerdezo.token}`)
      .send({ question: 'Elfér egy kombiban?' });
    expect(kerdes.status, JSON.stringify(kerdes.body)).toBeLessThan(400);

    const res = await torol(kerdezo.token);
    expect(res.status, `A TÖRLÉS ELHASALT: ${JSON.stringify(res.body)}`).toBe(200);
    expect(await letezik(kerdezo.id), 'a fiók a „sikeres" válasz ellenére megmaradt').toBe(false);
  });

  it('a kérdés megmarad (a fuvarhoz tartozik), de a kérdező anonimizálódik', async () => {
    const felado = await createUser({ role: 'shipper' });
    const kerdezo = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await request(app)
      .post(`/jobs/${job.id}/questions`)
      .set('Authorization', `Bearer ${kerdezo.token}`)
      .send({ question: 'Mikor lehet átvenni?' });

    await torol(kerdezo.token);

    const { rows } = await db.query('SELECT asker_id, question FROM job_questions WHERE job_id = $1', [job.id]);
    expect(rows.length).toBe(1);
    expect(rows[0].asker_id, 'a kérdező azonosítója a törlés után is megmaradt').toBeNull();

    // A fuvar-oldal továbbra is betölthető (a lekérdezés elbírja a NULL askert)
    const lista = await request(app)
      .get(`/jobs/${job.id}/questions`)
      .set('Authorization', `Bearer ${felado.token}`);
    expect(lista.status).toBe(200);
  });

  it('admin-törlésnél ugyanez érvényes', async () => {
    const admin = await createUser({ role: 'admin' });
    const felado = await createUser({ role: 'shipper' });
    const kerdezo = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await request(app)
      .post(`/jobs/${job.id}/questions`)
      .set('Authorization', `Bearer ${kerdezo.token}`)
      .send({ question: 'Van rakodó?' });

    const res = await request(app)
      .delete(`/admin/users/${kerdezo.id}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await letezik(kerdezo.id)).toBe(false);
  });
});

describe('Fiók-törlés: a fájlok csak SIKERES DB-törlés után tűnnek el', () => {
  it('a fájl-törlés a DB-törlés UTÁN fut (nem előtte)', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
       VALUES ($1, 'id_card', 'private:kyc/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', 'approved')`,
      [user.id],
    );

    // A sorrend a lényeg: amikor a tárolóból törlünk, a fióknak MÁR nem
    // szabad léteznie. A régi sorrendnél (fájl előbb) a fiók még megvolt —
    // és ha a DB-törlés utána elhasalt, az okmányfotó véglegesen elveszett,
    // miközben a felhasználó fiókja megmaradt.
    let letezettATorleskor = null;
    vi.spyOn(storage, 'deleteFile').mockImplementation(async () => {
      if (letezettATorleskor === null) letezettATorleskor = await letezik(user.id);
      return true;
    });

    const res = await torol(user.token);
    expect(res.status).toBe(200);
    expect(letezettATorleskor, 'a fájlokat a DB-törlés ELŐTT töröltük — visszafordíthatatlan lépés egy még elhasalható művelet előtt').toBe(false);
  });

  it('sikeres törlésnél a KYC-okmány fájlja is elmegy', async () => {
    const user = await createUser({ role: 'shipper' });
    const kulcs = 'private:kyc/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg';
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
       VALUES ($1, 'id_card', $2, 'approved')`,
      [user.id, kulcs],
    );
    const torlesSpy = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);

    const res = await torol(user.token);
    expect(res.status).toBe(200);
    expect(torlesSpy).toHaveBeenCalledWith(kulcs);
    expect(await letezik(user.id)).toBe(false);
  });
});
