// "Hozasd el": terméklink → OG-előnézet → fuvar-előtöltés → a termékkép
// eljut a sofőrig. A backend /link-preview hívását a böngészőben elfogjuk
// és determinisztikus IKEA-választ adunk — a teszt így nem függ külső
// weboldal elérhetőségétől, de a teljes web-oldali flow-t végigjárja.
import { test, expect } from '@playwright/test';
import { createUser, createJob, getJobRow, loginAs, selectAddress, setJobAccepted } from './helpers';

const PRODUCT_URL = 'https://www.ikea.com/hu/hu/p/billy-konyvespolc-feher-00263850/';
const PRODUCT_IMAGE = 'https://www.ikea.com/hu/hu/images/products/billy-konyvespolc-feher.jpg';

test('terméklink előnézete előtölti a feladást, a kép a sofőrig jut', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  await loginAs(page, shipper);

  // A backend /link-preview válaszát mockoljuk (a valódi IKEA-fetch a
  // backend SSRF-védett kódútja — azt a host-allowlisttel együtt a
  // backend tesztkészletében érdemes fedni, itt a web-flow a tárgy)
  await page.route('**/link-preview**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        source: 'IKEA',
        url: PRODUCT_URL,
        title: 'BILLY könyvespolc, fehér, 80x28x202 cm',
        image: PRODUCT_IMAGE,
        description: 'Kedvelt klasszikus könyvespolc.',
      }),
    }),
  );

  // ---- 1. Előnézet a terméklinkből ----
  await page.goto('/hozasd-el');
  await page.getByPlaceholder(/ikea\.com/).fill(PRODUCT_URL);
  await page.getByRole('button', { name: 'Előnézet' }).click();
  await expect(page.getByText('BILLY könyvespolc', { exact: false }).first()).toBeVisible();

  // ---- 2. Folytatás a feladásba — a cím előtöltve ----
  await page.getByRole('button', { name: /Folytatom a feladást/ }).click();
  await page.waitForURL(/uj-fuvar/);
  await expect(page.getByPlaceholder(/Költöztetés Budapest/)).toHaveValue(/BILLY/);

  // ---- 3. A maradék kötelező mezők + feladás ----
  await page.waitForFunction(() => Boolean((window as any).google?.maps?.places), null, {
    timeout: 30_000,
  });
  const addressInputs = page.getByPlaceholder('Kezdd el beírni a címet…');
  await selectAddress(page, addressInputs.first(), 'Budapest, Váci út 1');
  await selectAddress(page, addressInputs.nth(1), 'Szeged, Kossuth Lajos sugárút 1');
  await page.getByPlaceholder('pl. 120').fill('80');
  await page.getByPlaceholder('pl. 80').fill('28');
  await page.getByPlaceholder('pl. 100').fill('202');
  await page.getByPlaceholder('pl. 350').fill('30');
  await page.getByPlaceholder(/65000/).fill('12000');

  const [jobsResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/jobs') && r.request().method() === 'POST'),
    page.getByRole('button', { name: /Fuvar feladása/ }).click(),
  ]);
  expect(jobsResponse.status(), await jobsResponse.text()).toBe(201);
  const createdJob = await jobsResponse.json();

  // A kép-URL átment a backend host-allowlistjén és eltárolódott
  const row = await getJobRow(createdJob.id);
  expect(row.source_image_url).toBe(PRODUCT_IMAGE);

  // ---- 4. A sofőr a fuvar oldalán látja a termékképet ----
  const carrier = await createUser('carrier', 'Sofőr Sándor');
  await setJobAccepted(createdJob.id, carrier.id, { paid: true, priceHuf: 12000 });

  const carrierPage = await page.context().browser()!.newPage();
  await loginAs(carrierPage, carrier);
  await carrierPage.goto(`/sofor/fuvar/${createdJob.id}`);
  await expect(carrierPage.getByAltText(/hozandó termék/i)).toBeVisible();
  await carrierPage.close();
});
