// Regisztráció a valódi űrlapon + fuvar feladása a valódi Google Places
// cím-keresővel. Ez a két flow a platform "bejárata" — ha ezek törnek,
// senki nem jut el a licitig.
import { test, expect } from '@playwright/test';
import { createUser, loginAs, selectAddress } from './helpers';

test('regisztráció az űrlapon át — bejelentkezve landol', async ({ page }) => {
  await page.goto('/bejelentkezes?mode=register');

  await page.getByPlaceholder('Pl. Kovács Péter').fill('Regisztrációs Rege');
  await page.getByPlaceholder('pelda@email.hu').fill(`e2e-reg-${Date.now()}@teszt.gofuvar.hu`);
  await page.getByPlaceholder('Legalább 8 karakter').fill('Jelszo123!');
  await page.locator('form button[type="submit"]').click();

  // Sikeres regisztráció után elnavigál a login oldalról, bejelentkezett
  // állapotban (localStorage-ben ott a token)
  await page.waitForURL((url) => !url.pathname.startsWith('/bejelentkezes'), { timeout: 20_000 });
  const token = await page.evaluate(() => window.localStorage.getItem('gofuvar_token'));
  expect(token).toBeTruthy();
});

test('fuvar feladása — valódi Google Places cím-kereséssel', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  await loginAs(page, shipper);

  await page.goto('/dashboard/uj-fuvar');

  await page.getByPlaceholder(/Költöztetés Budapest/).fill('E2E teszt — költöztető dobozok');

  // Megvárjuk, míg a Google Maps SDK ténylegesen betölt (hideg dev-szerveren
  // ez az első oldalletöltésnél lassabb)
  await page.waitForFunction(() => Boolean((window as any).google?.maps?.places), null, {
    timeout: 30_000,
  });

  const addressInputs = page.getByPlaceholder('Kezdd el beírni a címet…');
  await selectAddress(page, addressInputs.first(), 'Budapest, Váci út 1');
  await selectAddress(page, addressInputs.nth(1), 'Szeged, Kossuth Lajos sugárút 1');

  // Méretek + súly + ár (a placeholderek a mező-példák)
  await page.getByPlaceholder('pl. 120').fill('40');
  await page.getByPlaceholder('pl. 80').fill('30');
  await page.getByPlaceholder('pl. 100').fill('20');
  await page.getByPlaceholder('pl. 350').fill('5');
  await page.getByPlaceholder(/65000/).fill('15000');

  // A submit POST /jobs válaszát is bevárjuk — ha a backend hibázna, a
  // teszt a valódi okot mutassa, ne csak egy navigációs timeoutot.
  const [jobsResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/jobs') && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    page.getByRole('button', { name: /Fuvar feladása/ }).click(),
  ]);
  expect(jobsResponse.status(), await jobsResponse.text()).toBe(201);

  // Sikeres feladás → a fuvar részletoldala
  await page.waitForURL(/\/dashboard\/fuvar\//, { timeout: 60_000 });
  await expect(page.getByText('E2E teszt — költöztető dobozok').first()).toBeVisible();
});
