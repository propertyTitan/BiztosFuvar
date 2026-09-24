// "Hozasd el": terméklink → OG-előnézet → fuvar-előtöltés → a termékkép
// eljut a szállítóig. A backend /link-preview hívását a böngészőben elfogjuk
// és determinisztikus IKEA-választ adunk — a teszt így nem függ külső
// weboldal elérhetőségétől, de a teljes web-oldali flow-t végigjárja.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {
  createUser, dbQuery, getJobRow, loginAs, selectAddress, setJobAccepted, TINY_PNG,
} from './helpers';

const PRODUCT_URL = 'https://www.ikea.com/hu/hu/p/billy-konyvespolc-feher-00263850/';
const PRODUCT_IMAGE = 'https://www.ikea.com/hu/hu/images/products/billy-konyvespolc-feher.jpg';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('gofuvar_cookie_consent', JSON.stringify({ necessary: true })));
});

test('vendég kézi feladása valódi regisztráción és email-kapun át is megmarad', async ({ page }) => {
  await page.goto('/hozasd-el/butor');
  await page.getByRole('button', { name: 'Link nélkül adom meg' }).click();
  await page.getByLabel('A szállítandó tárgy').fill('Marketplace kanapé');
  await page.getByLabel('Felvétel címe').fill('Budapest, Váci út 1.');
  await page.getByRole('button', { name: /Folytatom a feladást/ }).click();
  await page.waitForURL(/bejelentkezes.*next=/);
  const email = `e2e-hozasd-${Date.now()}@teszt.gofuvar.hu`;
  await page.getByPlaceholder('Pl. Kovács Péter').fill('Bútorvásárló Bea');
  await page.getByPlaceholder('pelda@email.hu').fill(email);
  await page.getByPlaceholder('Legalább 8 karakter').fill('Jelszo123!');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/dashboard\/uj-fuvar/);
  await expect(page.getByRole('heading', { name: 'Erősítsd meg az email címed' })).toBeVisible();
  // Az email kézbesítése külső szolgáltatás; csak a teszt-DB-ben igazoljuk
  // vissza, majd a felhasználó valós „Már megerősítettem” gombját használjuk.
  await dbQuery('UPDATE users SET email_verified = true WHERE email = $1', [email]);
  await page.getByRole('button', { name: /Már megerősítettem/ }).click();
  await expect(page.getByPlaceholder(/Költöztetés Budapest/)).toHaveValue('Marketplace kanapé');
  await expect(page.getByPlaceholder(/^pl\. Budapest/)).toHaveValue('Budapest, Váci út 1.');
  // Gépelés még nem megerősített térképes cím: a meglévő kapu marad.
  const confirmed = await page.evaluate(() => {
    const user = JSON.parse(localStorage.getItem('gofuvar_user')!);
    return JSON.parse(localStorage.getItem(`gofuvar_uj_fuvar_piszkozat:${user.id}`)!).adat.form.pickup_confirmed;
  });
  expect(confirmed).toBe(false);
});

test('vendég előnézete belépésen át megmarad, régi piszkozatot csak választás után cserél', async ({ page }) => {
  const user = await createUser('shipper');
  await page.route('**/link-preview**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    ok: true, source: 'IKEA', url: PRODUCT_URL, title: 'BILLY polc', image: PRODUCT_IMAGE, description: 'Új termék',
  }) }));
  await page.goto('/hozasd-el');
  await page.evaluate(id => localStorage.setItem(`gofuvar_uj_fuvar_piszkozat:${id}`, JSON.stringify({
    v: 1, at: Date.now(), adat: { form: { title: 'Régi dobozok', description: 'A korábbi címzettnek' } },
  })), user.id);
  await page.getByLabel('Hirdetés vagy termék linkje').fill(PRODUCT_URL);
  await page.getByRole('button', { name: 'Előnézet' }).click();
  await expect(page.getByLabel('A szállítandó tárgy')).toHaveValue('BILLY polc');
  await page.reload();
  await expect(page.getByLabel('A szállítandó tárgy')).toHaveValue('BILLY polc');
  await page.getByRole('button', { name: /Folytatom a feladást/ }).click();
  await page.waitForURL(/bejelentkezes/);
  await page.getByRole('button', { name: 'Belépés', exact: true }).first().click();
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Jelszó', { exact: true }).fill('Jelszo123!');
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL(/dashboard\/uj-fuvar/);
  await expect(page.getByRole('heading', { name: 'Melyik feladással folytatod?' })).toBeVisible();
  await expect(page.getByText('Régi dobozok', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Az új tárgy feladását kezdem' }).click();
  await expect(page.getByPlaceholder(/Költöztetés Budapest/)).toHaveValue('BILLY polc');
  await expect(page.getByLabel('Részletes leírás')).not.toHaveValue(/korábbi címzett/);
});

test('mobilos bútoroldal: sikertelen link után kézi út, akadálymentesség és nincs vízszintes kilógás', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/link-preview**', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Nem támogatott link' }) }));
  await page.goto('/hozasd-el/butor');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://www.gofuvar.hu/hozasd-el/butor');
  await page.getByLabel('Hirdetés vagy termék linkje').fill('https://www.facebook.com/marketplace/item/123');
  await page.getByRole('button', { name: 'Előnézet' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('link nélkül');
  await page.getByRole('button', { name: 'Link nélkül adom meg' }).click();
  await page.getByLabel('A szállítandó tárgy').fill('Kétszemélyes kanapé');
  await expect(page.getByLabel('Felvétel címe')).toBeEnabled();
  await expect(page.getByRole('button', { name: /Folytatom a feladást/ })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByLabel('Hirdetés vagy termék linkje').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(36);
  // Az axe átmenetileg módosítja az elemek stílusát a színméréshez.
  // A CSS-transition ettől a mérés KÖZBEN is elindulhat; itt a témák
  // végleges színeit mérjük, minden kontraszt-szabály bekapcsolva marad.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; } html { scroll-behavior: auto !important; }' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => {
      document.documentElement.setAttribute('data-theme', t);
    }, theme);
    const result = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.screenshot({ path: testInfo.outputPath(`hozasd-butor-mobile-${theme}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('hozasd-butor-desktop.png'), fullPage: true, animations: 'disabled' });
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
  await page.reload();
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
