// DAC7 adóazonosító-gyűjtés (Vinted-minta): az első teljesített fuvar után
// kérjük, 2 emlékeztető + 60 nap után az új ajánlattétel blokkolódik.
// Osztály-védelem: a bekérés SOSEM előzheti meg az első fuvart (konverzió!),
// cégeket SOSEM érinthet (nekik az adószám a TIN), és a blokk feloldódik,
// amint az adat megérkezik.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const {
  validatePersonalTaxId, computeTaxDataState,
  markTaxDataRequestedIfNeeded, runDailyDac7Reminders,
} = require('../src/services/dac7');

// Érvényes teszt-adóazonosító: 8371425902 (ellenőrző összeg: 178 mod 11 = 2)
const VALID_TAX_ID = '8371425902';

function bid(jobId, token) {
  return request(app)
    .post(`/jobs/${jobId}/bids`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount_huf: 12000, return_policy: 'included' });
}

function postTaxData(token, body) {
  return request(app)
    .post('/auth/tax-data')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

const GOOD_BODY = {
  personal_tax_id: VALID_TAX_ID,
  birth_date: '1990-05-10',
  address: '6800 Hódmezővásárhely, Teszt utca 1.',
};

describe('Adóazonosító jel validáció', () => {
  it('érvényes adóazonosítót elfogad (szóközökkel is)', () => {
    expect(validatePersonalTaxId(VALID_TAX_ID)).toBe(true);
    expect(validatePersonalTaxId('837 142 5902')).toBe(true);
  });

  it('rossz ellenőrző összeget, nem-8 kezdetet, rossz hosszt elutasít', () => {
    expect(validatePersonalTaxId('8371425903')).toBe(false); // rossz checksum
    expect(validatePersonalTaxId('7371425902')).toBe(false); // nem 8-cal kezdődik
    expect(validatePersonalTaxId('837142590')).toBe(false);  // 9 jegy
    expect(validatePersonalTaxId('')).toBe(false);
    expect(validatePersonalTaxId(null)).toBe(false);
  });
});

describe('Bekérés-trigger (első teljesített fuvar)', () => {
  it('magánszemélynél beállítja a requested_at-ot — idempotensen', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await markTaxDataRequestedIfNeeded(carrier.id);

    const { rows } = await db.query(
      'SELECT tax_data_requested_at FROM users WHERE id = $1', [carrier.id],
    );
    expect(rows[0].tax_data_requested_at).toBeTruthy();
    const first = rows[0].tax_data_requested_at;

    // Második hívás (második fuvar) nem nullázza az órát
    await markTaxDataRequestedIfNeeded(carrier.id);
    const { rows: again } = await db.query(
      'SELECT tax_data_requested_at FROM users WHERE id = $1', [carrier.id],
    );
    expect(again[0].tax_data_requested_at).toEqual(first);
  });

  it('céges szállítónál NEM indul bekérés (az adószám a TIN)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await db.query(`UPDATE users SET account_type = 'company' WHERE id = $1`, [carrier.id]);
    await markTaxDataRequestedIfNeeded(carrier.id);
    const { rows } = await db.query(
      'SELECT tax_data_requested_at FROM users WHERE id = $1', [carrier.id],
    );
    expect(rows[0].tax_data_requested_at).toBeNull();
  });
});

describe('POST /auth/tax-data', () => {
  it('érvényes adatokkal ment, és a bekért állapot megszűnik', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await markTaxDataRequestedIfNeeded(carrier.id);

    const res = await postTaxData(carrier.token, GOOD_BODY);
    expect(res.status).toBe(200);

    const { rows } = await db.query(
      `SELECT personal_tax_id, birth_date, billing_address FROM users WHERE id = $1`,
      [carrier.id],
    );
    expect(rows[0].personal_tax_id).toBe(VALID_TAX_ID);
    expect(rows[0].billing_address).toContain('Hódmezővásárhely');
    expect(computeTaxDataState({ ...rows[0], account_type: 'individual', tax_data_requested_at: new Date() }).needed)
      .toBe(false);
  });

  it('rossz checksumú adóazonosítóra 400', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const res = await postTaxData(carrier.token, { ...GOOD_BODY, personal_tax_id: '8371425903' });
    expect(res.status).toBe(400);
  });

  it('kamu születési dátumra és üres címre 400 (sosem 500)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    expect((await postTaxData(carrier.token, { ...GOOD_BODY, birth_date: 'nem-datum' })).status).toBe(400);
    expect((await postTaxData(carrier.token, { ...GOOD_BODY, birth_date: '2020-01-01' })).status).toBe(400); // 18 alatti
    expect((await postTaxData(carrier.token, { ...GOOD_BODY, address: '  ' })).status).toBe(400);
    expect((await postTaxData(carrier.token, { ...GOOD_BODY, personal_tax_id: { $ne: null } })).status).toBe(400);
  });

  it('céges fióknak 400 — tőle nem kérünk adóazonosító jelet', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await db.query(`UPDATE users SET account_type = 'company' WHERE id = $1`, [carrier.id]);
    const res = await postTaxData(carrier.token, GOOD_BODY);
    expect(res.status).toBe(400);
  });
});

describe('Kikényszerítés (2 emlékeztető + 60 nap → ajánlattétel blokkolva)', () => {
  async function makeOverdueCarrier() {
    const carrier = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET tax_data_requested_at = NOW() - INTERVAL '61 days',
              tax_data_reminder_count = 2
        WHERE id = $1`,
      [carrier.id],
    );
    return carrier;
  }

  it('határidőn túl, 2 emlékeztető után: 403 TAX_DATA_REQUIRED', async () => {
    const shipper = await createUser();
    const carrier = await makeOverdueCarrier();
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });

    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TAX_DATA_REQUIRED');
  });

  it('az adat megadása után a blokk azonnal feloldódik', async () => {
    const shipper = await createUser();
    const carrier = await makeOverdueCarrier();
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });

    await postTaxData(carrier.token, GOOD_BODY);
    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(201);
  });

  it('a 60 napos türelmi időn BELÜL nincs blokk (csak kérés van)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET tax_data_requested_at = NOW() - INTERVAL '10 days' WHERE id = $1`,
      [carrier.id],
    );
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(201);
  });

  it('céges szállítót sosem blokkol', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET account_type = 'company',
              tax_data_requested_at = NOW() - INTERVAL '61 days',
              tax_data_reminder_count = 2
        WHERE id = $1`,
      [carrier.id],
    );
    const job = await createJob({ shipperId: shipper.id, status: 'bidding' });
    const res = await bid(job.id, carrier.token);
    expect(res.status).toBe(201);
  });
});

describe('Napi emlékeztető-kör', () => {
  it('21 nap után küld, de ugyanannak kétszer egymás után nem', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET tax_data_requested_at = NOW() - INTERVAL '22 days' WHERE id = $1`,
      [carrier.id],
    );
    await runDailyDac7Reminders();
    const { rows } = await db.query(
      'SELECT tax_data_reminder_count FROM users WHERE id = $1', [carrier.id],
    );
    expect(rows[0].tax_data_reminder_count).toBe(1);

    // Másnapi futás: az intervallum-őr miatt nem duplázódik
    await runDailyDac7Reminders();
    const { rows: again } = await db.query(
      'SELECT tax_data_reminder_count FROM users WHERE id = $1', [carrier.id],
    );
    expect(again[0].tax_data_reminder_count).toBe(1);
  });

  it('aki már megadta, annak nem megy emlékeztető', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await db.query(
      `UPDATE users SET personal_tax_id = $2,
              tax_data_requested_at = NOW() - INTERVAL '30 days'
        WHERE id = $1`,
      [carrier.id, VALID_TAX_ID],
    );
    await runDailyDac7Reminders();
    const { rows } = await db.query(
      'SELECT tax_data_reminder_count FROM users WHERE id = $1', [carrier.id],
    );
    expect(rows[0].tax_data_reminder_count).toBe(0);
  });
});

describe('GET /auth/me — DAC7-állapot', () => {
  it('bekérés után needed=true + határidő; megadás után needed=false', async () => {
    const carrier = await createUser({ role: 'carrier' });
    await markTaxDataRequestedIfNeeded(carrier.id);

    const before = await request(app).get('/auth/me').set('Authorization', `Bearer ${carrier.token}`);
    expect(before.body.tax_data.needed).toBe(true);
    expect(before.body.tax_data.blocked).toBe(false);
    expect(before.body.tax_data.deadline).toBeTruthy();

    await postTaxData(carrier.token, GOOD_BODY);
    const after = await request(app).get('/auth/me').set('Authorization', `Bearer ${carrier.token}`);
    expect(after.body.tax_data.needed).toBe(false);
    expect(after.body.personal_tax_id).toBe(VALID_TAX_ID);
  });
});
