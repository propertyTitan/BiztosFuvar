// A teljes pénz-út két böngészőben (készpénzes modell): a szállító licitál, a
// feladó elfogad és kifizeti a kapcsolatfelvételi díjat (stub Barion, consent
// checkboxszal), a szállító felveszi és a címzett kódjával kézbesíti.
// Közben a friss fizetési guard UI-ját is ellenőrizzük: fizetés előtt a
// szállító "Fizetésre vár" kártyát lát, nem tud munkát indítani.
import { test, expect } from '@playwright/test';
import { createUser, createJob, getDeliveryCode, getJobRow, loginAs, TINY_PNG } from './helpers';

test('licit → elfogadás → fizetés → felvétel → kézbesítés kóddal', async ({ browser }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Szállító Sándor');
  const job = await createJob(shipper);

  const shipperCtx = await browser.newContext();
  const carrierCtx = await browser.newContext();
  const shipperPage = await shipperCtx.newPage();
  const carrierPage = await carrierCtx.newPage();
  await loginAs(shipperPage, shipper);
  await loginAs(carrierPage, carrier);

  // ---- 1. A szállító licitál ----
  await carrierPage.goto(`/sofor/fuvar/${job.id}`);
  await expect(carrierPage.getByText('E2E teszt fuvar — dobozok').first()).toBeVisible();

  await carrierPage.locator('form input[type="number"]').first().fill('12000');
  await carrierPage.getByText('Igen, benne van az ajánlatomban').click();
  await carrierPage.getByRole('button', { name: 'Ajánlat elküldése' }).click();
  await expect(carrierPage.getByText(/Ajánlat elküldve/).first()).toBeVisible();

  // ---- 2. A feladó látja és elfogadja a licitet ----
  await shipperPage.goto(`/dashboard/fuvar/${job.id}`);
  await expect(shipperPage.getByText(/Szállító Sándor/).first()).toBeVisible();
  await expect(shipperPage.getByText(/12\s?000/).first()).toBeVisible();

  await shipperPage.getByRole('button', { name: /^Elfogadom/ }).first().click();
  await expect(shipperPage.getByRole('button', { name: /Díj fizetése/ }).first()).toBeVisible({ timeout: 20_000 });

  // ---- 3. Fizetés ELŐTT a szállító nem tud munkát indítani ----
  await carrierPage.goto(`/sofor/fuvar/${job.id}`);
  await expect(carrierPage.getByText(/Fizetésre vár/).first()).toBeVisible();
  await expect(carrierPage.getByRole('button', { name: /Felvétel igazolása/ })).toHaveCount(0);

  // ---- 4. A feladó fizeti a kapcsolatfelvételi díjat (stub Barion) ----
  // Consent nélkül a fizetés nem indítható — a 45/2014-es nyilatkozat a
  // Barion-redirect ELŐTT kötelező (a gomb addig tiltott)
  await expect(shipperPage.getByRole('button', { name: /Díj fizetése/ })).toBeDisabled();
  await shipperPage.getByRole('checkbox').check();
  await shipperPage.getByRole('button', { name: /Díj fizetése/ }).click();
  await shipperPage.waitForURL(/fizetes-stub/, { timeout: 20_000 });
  // 12 000 Ft-os fuvar → 500 Ft-os sáv; a fuvardíj kápéban megy
  await expect(shipperPage.getByText(/KAPCSOLATFELVÉTELI DÍJ/).first()).toBeVisible();
  await expect(shipperPage.getByText(/500\s?Ft/).first()).toBeVisible();
  await shipperPage.getByRole('button', { name: /Fizetek most/ }).click();
  await shipperPage.waitForURL((url) => !url.pathname.includes('fizetes-stub'), { timeout: 20_000 });

  const paidRow = await getJobRow(job.id);
  expect(paidRow.paid_at).toBeTruthy();
  expect(paidRow.fee_consent_at).toBeTruthy(); // a jogi beleegyezés időbélyege mentve

  // ---- 4/b. A díj után a kontakt felfedve mindkét félnek ----
  await shipperPage.goto(`/dashboard/fuvar/${job.id}`);
  await expect(shipperPage.getByText(/A SZÁLLÍTÓ ELÉRHETŐSÉGE/).first()).toBeVisible({ timeout: 20_000 });

  // ---- 5. A szállító elindítja a fuvart (pickup fotó) ----
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

  // ---- 7. Adatbázis-végállapot: delivered (a fuvardíj kápéban ment, pénzmozgás nincs) ----
  const finalRow = await getJobRow(job.id);
  expect(finalRow.status).toBe('delivered');

  await shipperCtx.close();
  await carrierCtx.close();
});
