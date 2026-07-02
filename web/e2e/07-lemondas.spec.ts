// Fuvar lemondása kifizetett, elfogadott fuvaron: a lemondási díj az
// ÁSZF-szabály szerint számolódik (8 000 Ft felett 5%), a letét
// visszatérítésre kerül (stub-Barion refund).
import { test, expect } from '@playwright/test';
import { createUser, createJob, dbQuery, getJobRow, loginAs, setJobAccepted } from './helpers';

test('feladói lemondás fizetett fuvaron: 5% díj + letét-visszatérítés', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Sofőr Sándor');
  const job = await createJob(shipper);
  await setJobAccepted(job.id, carrier.id, { paid: true, priceHuf: 20000 });

  await loginAs(page, shipper);
  await page.goto(`/dashboard/fuvar/${job.id}`);

  await page.getByRole('button', { name: /Fuvar lemondása/ }).click();
  await expect(page.getByText('Fuvar lemondása').first()).toBeVisible();
  await page.locator('textarea:visible').last().fill('E2E teszt: már nem aktuális.');
  await page.getByRole('button', { name: 'Lemondom' }).click();

  await expect(page.getByText(/Lemondás kész/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Lemondva').first()).toBeVisible();

  // DB-végállapot: lemondva, 5% díj (20 000 → 1 000 Ft), a letét refunded
  const row = await getJobRow(job.id);
  expect(row.status).toBe('cancelled');
  expect(row.cancelled_by).toBe(shipper.id);
  expect(Number(row.cancellation_fee_huf)).toBe(1000);

  const { rows: esc } = await dbQuery(
    `SELECT status FROM escrow_transactions WHERE job_id = $1`, [job.id],
  );
  expect(esc[0].status).toBe('refunded');
});
