// =====================================================================
//  KUPON DUPLA-BEVÁLTÁS (double-spend) — pénz-invariáns
//
//  Részletes átvizsgálás (2026-08-08) találata. A useVoucherIfAvailable
//  (gamification.js) korábban külön SELECT + UPDATE volt, zárolás nélkül és
//  az UPDATE-en `used_at IS NULL` guard nélkül. Ez DOUBLE-SPEND-et engedett:
//  ha egy felhasználónak EGY kuponja van, és több fizetetlen fuvarra
//  egyszerre indít fizetést, minden kérés ugyanazt a kupont látja szabadnak,
//  mind „elhasználja", és MINDEGYIK fuvar díja elengedődik. Egy kuponnal több
//  ingyen-feladás — a platform bevétele szivárog.
//
//  ⚠️ TANULSÁG a teszt-erősségről: az első próbám KÉT egyidejű kérést lőtt ki,
//  és „átment" — a versenyablak túl keskeny volt 2 szálon, hamis zöldet adott.
//  8 egyidejű beváltásból viszont 7-8 sikerült egyetlen kuponra. Egy
//  versenyhelyzet-tesztnek ELÉG szálat kell indítania, hogy megbízhatóan
//  trigger­eljen — különben őrnek használhatatlan.
//
//  A javítás: egyetlen atomi UPDATE, aminek a belső SELECT-je
//  `FOR UPDATE SKIP LOCKED`-kal foglal le egy szabad kupont. A párhuzamos
//  kérések a zárolt sort átugorják → egy kupon garantáltan egyszer fogy, és
//  a többkuponos eset is helyesen (kuponként külön) működik.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { grantVoucher, useVoucherIfAvailable } = require('../src/services/gamification');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

describe('Kupon-beváltás versenymentes (szolgáltatás-szinten)', () => {
  it('EGY kupon + 8 egyidejű beváltás → pontosan EGY sikerül', async () => {
    // 8 szál: elég ahhoz, hogy a SELECT/UPDATE versenyablak megbízhatóan
    // trigger­eljen. Több körben, mert a verseny nem determinisztikus.
    for (let kor = 0; kor < 6; kor += 1) {
      const u = await createUser({ role: 'shipper' });
      await grantVoucher(u.id, 'referral', 60, 1000);

      const eredmenyek = await Promise.all(
        Array.from({ length: 8 }, () => useVoucherIfAvailable(u.id, { feeHuf: 500 })),
      );
      const sikeres = eredmenyek.filter(Boolean).length;
      expect(
        sikeres,
        `${kor}. kör: ${sikeres} beváltás sikerült EGY kuponra — double-spend!`,
      ).toBe(1);
    }
  });

  it('HÁROM kupon + 8 egyidejű beváltás → pontosan HÁROM sikerül (kuponként külön)', async () => {
    const u = await createUser({ role: 'shipper' });
    for (let i = 0; i < 3; i += 1) await grantVoucher(u.id, 'referral', 60, 1000);

    const eredmenyek = await Promise.all(
      Array.from({ length: 8 }, () => useVoucherIfAvailable(u.id, { feeHuf: 500 })),
    );
    expect(
      eredmenyek.filter(Boolean).length,
      'nem pontosan 3 kupon fogyott — vagy double-spend, vagy elveszett kupon',
    ).toBe(3);
  });

  it('a díj-plafon fölötti feladásra a kupon NEM alkalmazható', async () => {
    const u = await createUser({ role: 'shipper' });
    await grantVoucher(u.id, 'referral', 60, 1000);          // max 1000 Ft
    // 2000 Ft-os díj > 1000 Ft plafon → nem váltható be
    expect(await useVoucherIfAvailable(u.id, { feeHuf: 2000 })).toBe(false);
    // …de a plafon alatti díjra igen
    expect(await useVoucherIfAvailable(u.id, { feeHuf: 500 })).toBe(true);
  });

  it('lejárt kupon nem váltható be', async () => {
    const u = await createUser({ role: 'shipper' });
    await grantVoucher(u.id, 'referral', -1, 1000);          // tegnap lejárt
    expect(await useVoucherIfAvailable(u.id, { feeHuf: 500 })).toBe(false);
  });
});

describe('Kupon-beváltás a teljes /pay flow-n át', () => {
  const pay = (jobId, token) => request(app).post(`/jobs/${jobId}/pay`)
    .set('Authorization', `Bearer ${token}`).send({ consent: true });

  it('egymás után: az első fuvar ingyenes, a második már NEM', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await grantVoucher(felado.id, 'referral', 60, 1000);

    const jobA = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });
    const jobB = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false });

    const elso = await pay(jobA.id, felado.token);
    expect(elso.body.paid_via_voucher, 'az első fizetés nem a kupont használta').toBe(true);

    __resetRateLimitsForTests();
    const masodik = await pay(jobB.id, felado.token);
    expect(
      masodik.body.paid_via_voucher,
      'a második fuvar is ingyenes lett — a kupon kétszer fogyott',
    ).not.toBe(true);
  });

  it('a párhuzamos /pay két fuvarra sem enged el két díjat egy kuponnal', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    await grantVoucher(felado.id, 'referral', 60, 1000);

    const jobok = [];
    for (let i = 0; i < 5; i += 1) {
      jobok.push(await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false }));
    }
    await Promise.all(jobok.map((j) => pay(j.id, felado.token)));

    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS n FROM jobs
        WHERE id = ANY($1) AND paid_at IS NOT NULL AND connection_fee_huf = 0`,
      [jobok.map((j) => j.id)],
    );
    expect(
      rows[0].n,
      `${rows[0].n} fuvar lett ingyen — de csak 1 kupon volt`,
    ).toBeLessThanOrEqual(1);
  });
});
