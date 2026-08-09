// =====================================================================
//  AJÁNLÓI JUTALOM: a 0 Ft-os (kuponos) feladás NEM teljesítés
//
//  Audit 3. kör (2026-08-09). Az ajánlói program védelme az, hogy a
//  „teljesítés" drága: a meghívottnak TÉNYLEGESEN ki kell fizetnie egy
//  kapcsolatfelvételi díjat. A trigger viszont a `paid_at` beállásán ült —
//  amit a KUPONOS (0 Ft-os) feladás is beállít. Vagyis egy kapott ajánlói
//  kupon beváltása MAGA IS jutalmat termelt: minden új fiók a kapott
//  kuponnal „fizet", és ezzel újabb kupont vált ki az ajánlójának, egyetlen
//  forint bevétel nélkül (önfenntartó lánc).
//
//  A feltétel a szolgáltatásban (referral.js) van, nem a hívóban — így egy
//  későbbi új fizetési út sem tudja kikerülni.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { db, createUser, createJob } = require('./helpers');
const { maybeGrantReferralReward } = require('../src/services/referral');

async function meghivott() {
  const ajanlo = await createUser();
  const user = await createUser();
  await db.query('UPDATE users SET referred_by = $1 WHERE id = $2', [ajanlo.id, user.id]);
  return { ajanlo, user };
}

const kuponokSzama = async (userId) => (await db.query(
  `SELECT COUNT(*)::int AS c FROM fee_vouchers WHERE user_id = $1 AND reason = 'referral'`,
  [userId],
)).rows[0].c;

describe('Ajánlói jutalom: mi számít teljesítésnek', () => {
  it('kuponos (0 Ft-os) feladás NEM ad jutalmat az ajánlónak', async () => {
    const { ajanlo, user } = await meghivott();
    // Így néz ki a kuponos feladás: fizetett státusz, de NULLA díj
    const job = await createJob({ shipperId: user.id, status: 'accepted' });
    await db.query('UPDATE jobs SET paid_at = NOW(), connection_fee_huf = 0 WHERE id = $1', [job.id]);

    await maybeGrantReferralReward(user.id, { role: 'shipper', jobId: job.id });

    expect(await kuponokSzama(ajanlo.id), 'ÖNFENNTARTÓ KUPON-LÁNC: 0 Ft-os feladás jutalmat termelt!').toBe(0);
    const { rows } = await db.query('SELECT referral_reward_granted_at FROM users WHERE id = $1', [user.id]);
    expect(rows[0].referral_reward_granted_at, 'a meghívott „elhasználódott" jutalom nélkül').toBeNull();
  });

  it('ténylegesen megfizetett (>0 Ft) díj UTÁN jár a jutalom', async () => {
    const { ajanlo, user } = await meghivott();
    await createJob({ shipperId: user.id, status: 'accepted', paid: true }); // valódi díj

    await maybeGrantReferralReward(user.id, { role: 'shipper', jobId: null });

    expect(await kuponokSzama(ajanlo.id)).toBe(1);
  });

  it('a kuponos feladás után egy VALÓDI fizetés még kiváltja a jutalmat', async () => {
    const { ajanlo, user } = await meghivott();

    const ingyenes = await createJob({ shipperId: user.id, status: 'accepted' });
    await db.query('UPDATE jobs SET paid_at = NOW(), connection_fee_huf = 0 WHERE id = $1', [ingyenes.id]);
    await maybeGrantReferralReward(user.id, { role: 'shipper', jobId: ingyenes.id });
    expect(await kuponokSzama(ajanlo.id)).toBe(0);

    // Később valódi díjat fizet → most már jár
    await createJob({ shipperId: user.id, status: 'accepted', paid: true });
    await maybeGrantReferralReward(user.id, { role: 'shipper', jobId: null });
    expect(await kuponokSzama(ajanlo.id)).toBe(1);
  });

  it('a foglalási (Járat) ág valódi díja is teljesítés', async () => {
    const { ajanlo, user } = await meghivott();
    const { createBooking } = require('./helpers');
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await createBooking({
      shipperId: user.id, carrierId: szallito.id, status: 'confirmed', paid: true,
    });
    await db.query('UPDATE route_bookings SET connection_fee_huf = 500 WHERE id = $1', [booking.id]);

    await maybeGrantReferralReward(user.id, { role: 'shipper', jobId: null });
    expect(await kuponokSzama(ajanlo.id)).toBe(1);
  });
});
