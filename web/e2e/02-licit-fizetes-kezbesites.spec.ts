// A teljes pénz-út két böngészőben: a sofőr licitál, a feladó elfogad és
// fizet (stub Barion), a sofőr felveszi és a címzett kódjával kézbesíti.
// Közben a friss fizetési guard UI-ját is ellenőrizzük: fizetés előtt a
// sofőr "Fizetésre vár" kártyát lát, nem tud munkát indítani.
import { test, expect } from '@playwright/test';
import { createUser, createJob, getDeliveryCode, getJobRow, loginAs, TINY_PNG } from './helpers';

test('licit → elfogadás → fizetés → felvétel → kézbesítés kóddal', async ({ browser }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Sofőr Sándor');
  const job = await createJob(shipper);

  const shipperCtx = await browser.newContext();
  const carrierCtx = await browser.newContext();
  const shipperPage = await shipperCtx.newPage();
  const carrierPage = await carrierCtx.newPage();
  await loginAs(shipperPage, shipper);
  await loginAs(carrierPage, carrier);

  // ---- 1. A sofőr licitál ----
  await carrierPage.goto(`/sofor/fuvar/${job.id}`);
  await expect(carrierPage.getByText('E2E teszt fuvar — dobozok').first()).toBeVisible();

  await carrierPage.locator('form input[type="number"]').first().fill('12000');
  await carrierPage.getByText('Igen, benne van az ajánlatomban').click();
  await carrierPage.getByRole('button', { name: 'Licit elküldése' }).click();
  await expect(carrierPage.getByText(/Licit elküldve/).first()).toBeVisible();

  // ---- 2. A feladó látja és elfogadja a licitet ----
  await shipperPage.goto(`/dashboard/fuvar/${job.id}`);
  await expect(shipperPage.getByText(/Sofőr Sándor/).first()).toBeVisible();
  await expect(shipperPage.getByText(/12\s?000/).first()).toBeVisible();

  await shipperPage.getByRole('button', { name: /^Elfogadom/ }).first().click();
  await expect(shipperPage.getByText(/Fizetés Barionnal/).first()).toBeVisible({ timeout: 20_000 });

  // ---- 3. Fizetés ELŐTT a sofőr nem tud munkát indítani ----
  await carrierPage.goto(`/sofor/fuvar/${job.id}`);
  await expect(carrierPage.getByText(/Fizetésre vár/).first()).toBeVisible();
  await expect(carrierPage.getByRole('button', { name: /Felvétel igazolása/ })).toHaveCount(0);

  // ---- 4. A feladó fizet (stub Barion) ----
  await shipperPage.getByRole('button', { name: /Fizetés Barionnal/ }).click();
  await shipperPage.waitForURL(/fizetes-stub/, { timeout: 20_000 });
  await shipperPage.getByRole('button', { name: /Fizetek most/ }).click();
  await shipperPage.waitForURL((url) => !url.pathname.includes('fizetes-stub'), { timeout: 20_000 });

  const paidRow = await getJobRow(job.id);
  expect(paidRow.paid_at).toBeTruthy();

  // ---- 5. A sofőr elindítja a fuvart (pickup fotó) ----
  await carrierPage.goto(`/sofor/fuvar/${job.id}`);
  await expect(carrierPage.getByText(/Fuvar indítása/).first()).toBeVisible();
  await carrierPage.locator('#pickup-photo').setInputFiles({
    name: 'felvetel.png', mimeType: 'image/png', buffer: TINY_PNG,
  });
  await carrierPage.getByRole('button', { name: /Felvétel igazolása/ }).click();
  await expect(carrierPage.getByText(/Kézbesítés igazolása/).first()).toBeVisible({ timeout: 20_000 });

  // ---- 6. Kézbesítés a címzett 6 jegyű kódjával ----
  const code = await getDeliveryCode(job.id);
  await carrierPage.locator('#dropoff-photo').setInputFiles({
    name: 'atadas.png', mimeType: 'image/png', buffer: TINY_PNG,
  });
  await carrierPage.getByPlaceholder('••••••').fill(code);
  await carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ }).click();
  await expect(carrierPage.getByText(/kézbesítve|lezárult/i).first()).toBeVisible({ timeout: 20_000 });

  // ---- 7. Adatbázis-végállapot: delivered + felszabadított letét ----
  const finalRow = await getJobRow(job.id);
  expect(finalRow.status).toBe('delivered');

  await shipperCtx.close();
  await carrierCtx.close();
});
