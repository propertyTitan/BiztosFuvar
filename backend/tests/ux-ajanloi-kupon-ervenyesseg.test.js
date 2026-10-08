// =====================================================================
//  UX-review Q19 (2026-10-08): az ajánlói kupon 60 nap után lejár — és ezt
//  a felület is kimondja.
//
//  (1) SZINKRON-ŐR: a web ReferralCard a kupon érvényességét saját
//      konstansból írja ki („A kupon 60 napig érvényes…”); ha a
//      backend REFERRAL_VOUCHER_VALID_DAYS-e megváltozik, a felület némán
//      hazudna. Ez a teszt a két számot egymáshoz méri.
//  (2) legkozelebbiKuponLejarat: a „Érvényes: <dátum>-ig” sor forrása —
//      ugyanazokkal a feltételekkel, mint a beváltás (felhasználatlan,
//      érvényes, nem lejárt), a legkorábban lejárót adja.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const request = require('supertest');
const { db, app, createUser } = require('./helpers');
const referral = require('../src/services/referral');

describe('ajánlói kupon — web ↔ backend szinkron', () => {
  it('a ReferralCard napszáma azonos a backend REFERRAL_VOUCHER_VALID_DAYS-ével', () => {
    const forras = fs.readFileSync(
      path.join(__dirname, '..', '..', 'web', 'src', 'components', 'ReferralCard.tsx'), 'utf8',
    );
    const m = /AJANLOI_KUPON_ERVENYES_NAP\s*=\s*(\d+)/.exec(forras);
    expect(m, 'a ReferralCard nem a közös konstansból írja ki a kupon érvényességét').toBeTruthy();
    expect(Number(m[1])).toBe(referral.REFERRAL_VOUCHER_VALID_DAYS);
  });

  it('a jutalom-értesítés is kimondja az érvényességet — és hogy a díjfizetésnél váltódik be', () => {
    const forras = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'referral.js'), 'utf8');
    expect(forras).toMatch(/A kupon \$\{REFERRAL_VOUCHER_VALID_DAYS\} napig érvényes: ha ezalatt szállítót választasz, a díjfizetés lépésénél/);
    // A kupon a /pay-en váltódik be (useVoucherIfAvailable: valid_until >=
    // CURRENT_DATE a BEVÁLTÁS napján) — a feladás napja nem számít, ezért a
    // „ha N napon belül adsz fel fuvart” ígéret hamis volt (fix1-review).
    expect(forras).not.toMatch(/napon belül adsz fel fuvart/);
  });
});

describe('legkozelebbiKuponLejarat', () => {
  it('a legkorábban lejáró, még felhasználható kupon napja; lejárt/felhasznált nem számít', async () => {
    const u = await createUser({ role: 'shipper' });
    expect(await referral.legkozelebbiKuponLejarat(u.id)).toBeNull();
    await db.query(
      `INSERT INTO fee_vouchers (user_id, reason, valid_until) VALUES
         ($1, 'referral', CURRENT_DATE + 40),
         ($1, 'referral', CURRENT_DATE + 10),
         ($1, 'referral', CURRENT_DATE - 1)`,
      [u.id],
    );
    await db.query(
      `INSERT INTO fee_vouchers (user_id, reason, valid_until, used_at) VALUES ($1, 'referral', CURRENT_DATE + 2, NOW())`,
      [u.id],
    );
    const { rows } = await db.query("SELECT to_char(CURRENT_DATE + 10, 'YYYY-MM-DD') AS v");
    expect(await referral.legkozelebbiKuponLejarat(u.id)).toBe(rows[0].v);
  });
});

describe('GET /auth/referral — a ReferralCard „Érvényes: …-ig” sorának forrása', () => {
  it('a legkorábban lejáró kupon napját adja voucherValidUntil-ként; kupon nélkül null', async () => {
    const u = await createUser({ role: 'shipper' });
    const ures = await request(app).get('/auth/referral').set('Authorization', `Bearer ${u.token}`);
    expect(ures.status).toBe(200);
    expect(ures.body.voucherValidUntil).toBeNull();

    await db.query(
      `INSERT INTO fee_vouchers (user_id, reason, valid_until) VALUES
         ($1, 'referral', CURRENT_DATE + 30),
         ($1, 'referral', CURRENT_DATE + 5)`,
      [u.id],
    );
    const res = await request(app).get('/auth/referral').set('Authorization', `Bearer ${u.token}`);
    const { rows } = await db.query("SELECT to_char(CURRENT_DATE + 5, 'YYYY-MM-DD') AS v");
    expect(res.body.availableVouchers).toBe(2);
    expect(res.body.voucherValidUntil).toBe(rows[0].v);
  });
});
