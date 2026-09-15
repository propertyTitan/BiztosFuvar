import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser, createJob, createBooking } = require('./helpers');
const storage = require('../src/services/storage');
const { purgeDormantAccounts } = require('../src/services/retention');
afterEach(() => vi.restoreAllMocks());
const exists = async (id) => (await db.query('SELECT id FROM users WHERE id = $1', [id])).rows.length > 0;
const remove = (user) => request(app).delete('/auth/me').set('Authorization', `Bearer ${user.token}`);
const callback = (paymentId, status) => request(app).post('/payments/cib/callback').send({ PaymentId: paymentId, Status: status });

describe('P1-01: függő fizetés túléli a törlési kérést', () => {
  it('banki indítás közben kezdett törlés is megvárja és védi a rögzített sessiont', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id });
    let reached, resume;
    const started = new Promise(resolve => { reached = resolve; });
    const paused = new Promise(resolve => { resume = resolve; });
    const paymentId = `during-start-${job.id}`;
    vi.spyOn(require('../src/services/paymentProvider'), 'startFeePayment').mockImplementation(async () => {
      reached(); await paused;
      return { paymentId, gatewayUrl: `stub:${paymentId}`, stub: true };
    });
    const payment = request(app).post(`/jobs/${job.id}/pay`).set('Authorization', `Bearer ${shipper.token}`)
      .send({ consent: true }).then(res => res);
    await started;
    const deletion = remove(shipper).then(res => res);
    try {
      await vi.waitFor(async () => {
        const locks = await db.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
        expect(locks.rows.length).toBeGreaterThan(0);
      });
    } finally { resume(); }
    expect((await payment).status).toBe(200);
    expect((await deletion).status).toBe(409);
    expect(await exists(shipper.id)).toBe(true);
    expect((await callback(paymentId, 'Succeeded')).body.unknown).not.toBe(true);
  });
  it.each(['job', 'booking'])('%s: függő session mellett 409; későbbi callback könyvel', async (type) => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    let id, paymentId;
    if (type === 'job') {
      const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id }); id = job.id;
      const pay = await request(app).post(`/jobs/${id}/pay`).set('Authorization', `Bearer ${shipper.token}`).send({ consent: true });
      expect(pay.status, JSON.stringify(pay.body)).toBe(200);
      paymentId = (await db.query('SELECT barion_payment_id FROM escrow_transactions WHERE job_id = $1', [id])).rows[0].barion_payment_id;
    } else {
      const { booking } = await createBooking({ shipperId: shipper.id, carrierId: carrier.id, status: 'pending' }); id = booking.id;
      expect((await request(app).post(`/route-bookings/${id}/confirm`).set('Authorization', `Bearer ${carrier.token}`).send({})).status).toBe(200);
      paymentId = (await db.query('SELECT barion_payment_id FROM route_bookings WHERE id = $1', [id])).rows[0].barion_payment_id;
    }
    expect((await remove(shipper)).status).toBe(409);
    expect((await remove(carrier)).status).toBe(409);
    expect((await callback(paymentId, 'Succeeded')).body.unknown).not.toBe(true);
    expect((await db.query(`SELECT paid_at FROM ${type === 'job' ? 'jobs' : 'route_bookings'} WHERE id = $1`, [id])).rows[0].paid_at).not.toBeNull();
  });

  it('új session nem felejti el a régit; csak mindkettő banki lezárása enged törölni', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id });
    const oldId = `old-${job.id}`, newId = `new-${job.id}`;
    await db.query("INSERT INTO escrow_transactions(job_id, amount_huf, barion_payment_id) VALUES($1, 500, $2)", [job.id, oldId]);
    await db.query('UPDATE escrow_transactions SET barion_payment_id = $2 WHERE job_id = $1', [job.id, newId]);
    await callback(newId, 'Expired');
    expect((await remove(shipper)).status).toBe(409);
    const result = await callback(oldId, 'Canceled');
    expect(result.body.unknown).not.toBe(true);
    expect((await remove(shipper)).status).toBe(200);
    expect(await exists(shipper.id)).toBe(false);
  });

  it('felülírt session Succeeded eredménye a saját eredeti díját könyveli', async () => {
    const shipper = await createUser();
    const job = await createJob({ shipperId: shipper.id });
    const oldId = `first-${job.id}`;
    await db.query('INSERT INTO escrow_transactions(job_id, amount_huf, barion_payment_id) VALUES($1, 500, $2)', [job.id, oldId]);
    await db.query('UPDATE escrow_transactions SET barion_payment_id = $2, amount_huf = 1000 WHERE job_id = $1', [job.id, `next-${job.id}`]);
    expect((await callback(oldId, 'Succeeded')).body.unknown).not.toBe(true);
    const receipt = (await db.query('SELECT fee_huf FROM fee_payment_receipts WHERE payment_id = $1', [oldId])).rows[0];
    expect(receipt.fee_huf).toBe(500);
    expect((await remove(shipper)).status).toBe(409);
  });
});

describe('P1-06/P1-07: közös, visszagörgethető fióktörlés és tartós fájltakarítás', () => {
  it('DELETE-hiba a tartós fájlfeladatot és a törlési auditot is visszavonja', async () => {
    const user = await createUser();
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [user.id, `private:kyc/${user.id}.png`]);
    const deletion = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
    await db.query(`CREATE FUNCTION launch_user_delete_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'user delete failure'; END $$`);
    await db.query(`CREATE TRIGGER launch_user_delete_failure BEFORE DELETE ON users
      FOR EACH ROW WHEN (OLD.id = '${user.id}'::uuid) EXECUTE FUNCTION launch_user_delete_failure()`);
    try {
      expect((await remove(user)).status).toBe(500);
      expect(await exists(user.id)).toBe(true);
      expect(deletion).not.toHaveBeenCalled();
      expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE batch_id = $1', [user.id])).rows).toHaveLength(0);
      expect((await db.query('SELECT 1 FROM deleted_accounts WHERE original_user_id = $1', [user.id])).rows).toHaveLength(0);
    } finally { await db.query('DROP FUNCTION launch_user_delete_failure() CASCADE'); }
  });
  it('kulcsgyűjtés valós SQL-hibája megőrzi a fiókot és az auditot sem írja félig', async () => {
    const user = await createUser();
    await db.query('ALTER TABLE kyc_documents RENAME COLUMN file_url TO launch_hidden_file_url');
    try {
      expect((await remove(user)).status).toBe(500);
      expect(await exists(user.id)).toBe(true);
      expect((await db.query('SELECT 1 FROM deleted_accounts WHERE original_user_id = $1', [user.id])).rows).toHaveLength(0);
    } finally { await db.query('ALTER TABLE kyc_documents RENAME COLUMN launch_hidden_file_url TO file_url'); }
  });

  it('tárhelyhiba után a törlendő kulcs megmarad; a későbbi worker végrehajtja', async () => {
    const user = await createUser();
    const key = `private:kyc/${user.id}.png`;
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [user.id, key]);
    const deletion = vi.spyOn(storage, 'deleteFile').mockResolvedValue(false);
    const result = await remove(user);
    expect(result.status).toBe(200);
    expect(result.body.files_pending).toBe(true);
    expect(await exists(user.id)).toBe(false);
    expect((await db.query('SELECT file_key, attempts FROM file_deletion_queue WHERE batch_id = $1', [user.id])).rows)
      .toEqual([{ file_key: key, attempts: 1 }]);
    deletion.mockResolvedValue(true);
    await db.query("UPDATE file_deletion_queue SET next_attempt_at = NOW() WHERE batch_id = $1", [user.id]);
    expect(await require('../src/services/fileDeletionQueue').processFileDeletionQueue({ batchId: user.id })).toBe(1);
    expect((await db.query('SELECT 1 FROM file_deletion_queue WHERE batch_id = $1', [user.id])).rows).toHaveLength(0);
  });

  it.each(['self', 'admin', 'dormant'])('%s törlés: értékelés szövege ürül, csillag marad, törlési és KYC-nyom rögzül', async (mode) => {
    const user = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: user.id, carrierId: carrier.id, status: 'delivered' });
    const hash = `launch-hash-${user.id}`;
    await db.query("INSERT INTO kyc_documents(user_id, doc_type, doc_number_hash, hash_algo, status) VALUES($1, 'id_card', $2, 'hmac-sha256', 'approved')", [user.id, hash]);
    await db.query("INSERT INTO kyc_doc_history(doc_number_hash, hash_algo) VALUES($1, 'hmac-sha256')", [hash]);
    const review = (await db.query("INSERT INTO reviews(job_id, reviewer_id, reviewee_id, rating, comment) VALUES($1, $2, $3, 5, 'Személyes szabad szöveg') RETURNING id", [job.id, user.id, carrier.id])).rows[0];
    if (mode === 'self') expect((await remove(user)).status).toBe(200);
    if (mode === 'admin') {
      const admin = await createUser({ role: 'admin' });
      expect((await request(app).delete(`/admin/users/${user.id}`).set('Authorization', `Bearer ${admin.token}`)).status).toBe(200);
    }
    if (mode === 'dormant') {
      await db.query("UPDATE users SET last_login_at = NOW() - INTERVAL '4 years', dormant_warned_at = NOW() - INTERVAL '31 days' WHERE id = $1", [user.id]);
      await purgeDormantAccounts();
    }
    expect(await exists(user.id)).toBe(false);
    expect((await db.query('SELECT reviewer_id, comment, rating FROM reviews WHERE id = $1', [review.id])).rows[0])
      .toEqual({ reviewer_id: null, comment: null, rating: 5 });
    expect((await db.query('SELECT 1 FROM deleted_accounts WHERE original_user_id = $1', [user.id])).rows).toHaveLength(1);
    expect((await db.query('SELECT deleted_account_count, last_deletion_reason FROM kyc_doc_history WHERE doc_number_hash = $1', [hash])).rows[0])
      .toEqual({ deleted_account_count: 1, last_deletion_reason: mode });
  });
});
