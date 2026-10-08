// =====================================================================
//  UX-review Q19 (2026-10-08): az ajánlói kupon 60 nap után lejár — és ezt
//  a felület is kimondja.
//
//  (1) SZINKRON-ŐR: a web ReferralCard a kupon érvényességét saját
//      konstansból írja ki („ha 60 napon belül adsz fel fuvart”); ha a
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
const { db, createUser } = require('./helpers');
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

  it('a jutalom-értesítés is kimondja az érvényességet', () => {
    const forras = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'referral.js'), 'utf8');
    expect(forras).toMatch(/ha \$\{REFERRAL_VOUCHER_VALID_DAYS\} napon belül adsz fel fuvart/);
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
