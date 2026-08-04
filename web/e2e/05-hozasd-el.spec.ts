// "Hozasd el": terméklink → OG-előnézet → fuvar-előtöltés → a termékkép
// eljut a szállítóig. A backend /link-preview hívását a böngészőben elfogjuk
// és determinisztikus IKEA-választ adunk — a teszt így nem függ külső
// weboldal elérhetőségétől, de a teljes web-oldali flow-t végigjárja.
import { test, expect } from '@playwright/test';
import {
  createUser, createJob, getJobRow, loginAs, selectAddress, setJobAccepted, TINY_PNG,
} from './helpers';

const PRODUCT_URL = 'https://www.ikea.com/hu/hu/p/billy-konyvespolc-feher-00263850/';
const PRODUCT_IMAGE = 'https://www.ikea.com/hu/hu/images/products/billy-konyvespolc-feher.jpg';

// Tesztelői észrevétel (2026-08-04): belépés nélkül is végig lehetett menni a
// „Hozasd el" eszközön, hogy aztán a feladásnál derüljön ki, hogy be kell lépni.
// A marketing-szöveg (SEO) marad publikus, az ESZKÖZ viszont belépéshez kötött.
test('belépés nélkül a Hozasd el eszköz zárva, a landing-szöveg látszik', async ({ page }) => {
  await page.goto('/hozasd-el');

  // A SEO/marketing tartalom változatlanul kint van
  await expect(page.getByRole('heading', { name: /Hozasd el/ })).toBeVisible();

  // …de az eszköz helyén belépés-kapu áll
  await expect(page.getByText('A feladáshoz belépés kell')).toBeVisible();
  await expect(page.getByPlaceholder(/ikea\.com/)).toHaveCount(0);

  await page.getByRole('link', { name: 'Belépés' }).first().click();
  await page.waitForURL(/bejelentkezes/);
});

test('terméklink előnézete előtölti a feladást, a kép a szállítóig jut', async ({ page }) => {
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
  // A címmezők placeholdere a házszám-kötelezettség óta a várt formátumot
  // mutatja („pl. Budapest, Váci út 1.") — a közös prefixre szűrünk.
  const addressInputs = page.getByPlaceholder(/^pl\. (Budapest|Szeged)/);
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

  // ---- 4. A szállító a fuvar oldalán látja a termékképet ----
  const carrier = await createUser('carrier', 'Szállító Sándor');
  await setJobAccepted(createdJob.id, carrier.id, { paid: true, priceHuf: 12000 });

  const carrierPage = await page.context().browser()!.newPage();
  // A kamu IKEA kép-URL-t valódi PNG-vel szolgáljuk ki — a 404-re az <img>
  // onError-je elrejtené a képet, és a teszt a külső hoszttól függene
  await carrierPage.route(PRODUCT_IMAGE, (route) =>
    route.fulfill({ contentType: 'image/png', body: TINY_PNG }),
  );
  await loginAs(carrierPage, carrier);
  await carrierPage.goto(`/sofor/fuvar/${createdJob.id}`);
  await expect(carrierPage.getByAltText(/hozandó termék/i)).toBeVisible();
  await carrierPage.close();
});
