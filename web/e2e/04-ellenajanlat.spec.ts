// Ellenajánlat (Vinted-stílusú alku): a feladó ellenajánlatot küld a sofőr
// licitjére, a sofőr elfogadja — a fuvar az alku-áron kerül elfogadásra.
import { test, expect } from '@playwright/test';
import { createUser, createJob, placeBid, getJobRow, loginAs } from './helpers';

test('feladói ellenajánlat → sofőr elfogadja → alku-áras elfogadott fuvar', async ({ browser }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Sofőr Sándor');
  const job = await createJob(shipper);
  await placeBid(carrier, job.id, 12000);

  const shipperCtx = await browser.newContext();
  const carrierCtx = await browser.newContext();
  const shipperPage = await shipperCtx.newPage();
  const carrierPage = await carrierCtx.newPage();
  await loginAs(shipperPage, shipper);
  await loginAs(carrierPage, carrier);

  // ---- 1. A feladó ellenajánlatot küld a 12 000 Ft-os licitre ----
  await shipperPage.goto(`/dashboard/fuvar/${job.id}`);
  await expect(shipperPage.getByText(/12\s?000/).first()).toBeVisible();

  await shipperPage.getByRole('button', { name: 'Ellenajánlat' }).click();
  await expect(shipperPage.getByText('Ellenajánlat küldése')).toBeVisible();
  await shipperPage.locator('input[type="number"]:visible').last().fill('10000');
  await shipperPage.getByRole('button', { name: 'Ellenajánlat elküldése' }).click();

  await expect(shipperPage.getByText(/Elküldted az ellenajánlatod/).first()).toBeVisible();

  // ---- 2. A sofőr látja és elfogadja az ellenajánlatot ----
  await carrierPage.goto(`/sofor/fuvar/${job.id}`);
  await expect(carrierPage.getByText(/A feladó ellenajánlata/).first()).toBeVisible();
  await expect(carrierPage.getByText(/10\s?000/).first()).toBeVisible();

  await carrierPage.getByRole('button', { name: /^Elfogadom/ }).click();

  // Elfogadás után a fuvar az övé — fizetetlen, tehát "Fizetésre vár"
  await expect(carrierPage.getByText(/Fizetésre vár/).first()).toBeVisible({ timeout: 20_000 });

  // ---- 3. DB-végállapot: elfogadva, PONT az alku-áron ----
  const row = await getJobRow(job.id);
  expect(row.status).toBe('accepted');
  expect(row.carrier_id).toBe(carrier.id);
  expect(Number(row.accepted_price_huf)).toBe(10000);

  await shipperCtx.close();
  await carrierCtx.close();
});
