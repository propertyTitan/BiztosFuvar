// Lemondás a készpénzes modellben: pénzmozgás nincs. Két ág:
//  - a FELADÓ lemondja a fizetett fuvart → cancelled, díj nem jár vissza
//  - a SZÁLLÍTÓ lép vissza → a fuvar díjmentesen újranyílik, a feladó a korábbi
//    ajánlatok közül új fizetés nélkül választhat
import { test, expect } from '@playwright/test';
import { createUser, createJob, dbQuery, getJobRow, loginAs, placeBid, setJobAccepted } from './helpers';

test('feladói lemondás fizetett fuvaron: nincs díj, nincs refund, a díj-sor released marad', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Szállító Sándor');
  const job = await createJob(shipper);
  await setJobAccepted(job.id, carrier.id, { paid: true, priceHuf: 20000 });

  await loginAs(page, shipper);
  await page.goto(`/dashboard/fuvar/${job.id}`);

  await page.getByRole('button', { name: /Fuvar lemondása/ }).click();
  await expect(page.getByText('Fuvar lemondása').first()).toBeVisible();
  // A dialógus őszintén közli: a kapcsolatfelvételi díj nem jár vissza
  await expect(page.getByText(/nem visszatérítendő/).first()).toBeVisible();
  await page.locator('textarea:visible').last().fill('E2E teszt: már nem aktuális.');
  await page.getByRole('button', { name: 'Lemondom' }).click();

  await expect(page.getByText(/Lemondás kész/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Lemondva').first()).toBeVisible();

  // DB-végállapot: lemondva, lemondási díj nincs, a befizetett díj végleges
  const row = await getJobRow(job.id);
  expect(row.status).toBe('cancelled');
  expect(row.cancelled_by).toBe(shipper.id);
  expect(Number(row.cancellation_fee_huf)).toBe(0);
  expect(Number(row.refund_huf)).toBe(0);

  const { rows: esc } = await dbQuery(
    `SELECT status FROM escrow_transactions WHERE job_id = $1`, [job.id],
  );
  expect(esc[0].status).toBe('released');
});

test('szállító-visszalépés: díjmentes újraválasztás a korábbi ajánlatok közül', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Szállító Sándor');
  const backup = await createUser('carrier', 'Tartalék Tibor');
  const job = await createJob(shipper);
  // Két licit, majd az első szállító elfogadva + díj fizetve
  await placeBid(carrier, job.id, 20000);
  await placeBid(backup, job.id, 22000);
  await setJobAccepted(job.id, carrier.id, { paid: true, priceHuf: 20000 });
  await dbQuery(
    `UPDATE bids SET status = CASE WHEN carrier_id = $2
        THEN 'accepted'::bid_status ELSE 'rejected'::bid_status END
      WHERE job_id = $1`,
    [job.id, carrier.id],
  );

  // A feladó szállítót cserél (a szállító nem elérhető)
  await loginAs(page, shipper);
  await page.goto(`/dashboard/fuvar/${job.id}`);
  await page.getByRole('button', { name: /Másik szállítót választok/ }).click();
  await page.getByRole('button', { name: 'Újranyitom' }).click();
  await expect(page.getByText(/Fuvar újranyitva/).first()).toBeVisible({ timeout: 20_000 });

  // A licit-lista újra él, a "díjmentes újraválasztás" jelvénnyel
  await expect(page.getByText(/Díjmentes újraválasztás/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Tartalék Tibor/).first()).toBeVisible();

  // A tartalék szállító elfogadása — új fizetés NEM kell, a kontakt azonnal jön
  await page.getByRole('button', { name: /^Elfogadom/ }).first().click();
  await expect(page.getByText(/A SZÁLLÍTÓ ELÉRHETŐSÉGE/).first()).toBeVisible({ timeout: 20_000 });

  const row = await getJobRow(job.id);
  expect(row.status).toBe('accepted');
  expect(row.carrier_id).toBe(backup.id);
  expect(row.paid_at).toBeTruthy(); // a korábban fizetett díj érvényben maradt
  expect(Number(row.reopened_count)).toBe(1);
});
