import { test, expect } from '@playwright/test';
import { createUser, loginAs } from './helpers';

for (const mode of ['error', 'stalled'] as const) {
  test(`címkereső ${mode}: újrapróbálás után valódi címválasztás, megőrzött űrlap`, async ({ page }) => {
    const shipper = await createUser('shipper', `Maps recovery ${mode}`);
    await loginAs(page, shipper);
    const mapsScript = 'https://maps.googleapis.com/maps/api/js?**';
    let release!: () => void;
    const stalled = new Promise<void>(resolve => { release = resolve; });
    await page.route(mapsScript, async route => {
      if (mode === 'stalled') {
        await stalled;
        await route.continue().catch(() => {});
      } else {
        await route.abort().catch(() => {});
      }
    });
    try {
      // A szándékosan függő külső script miatt a window.load nem érkezik meg.
      await page.goto('/dashboard/uj-fuvar', { waitUntil: 'domcontentloaded' });
      const title = page.getByPlaceholder(/Költöztetés Budapest/);
      await title.fill('Ezt a címet és a fuvar adatait megőrizzük');
      const retry = page.getByRole('button', { name: 'Címkereső újratöltése' }).first();
      await expect(retry).toBeVisible({ timeout: 25_000 });
      await page.unroute(mapsScript);
      await retry.click();
      // Visszatér a kapcsolat: a függő kérés is választ kaphat.
      release();
      const pickup = page.getByPlaceholder(/Budapest, Váci út/).first();
      await expect(pickup).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Címkereső újratöltése' })).toHaveCount(0);
      await expect(title).toHaveValue('Ezt a címet és a fuvar adatait megőrizzük');
      await pickup.pressSequentially('Budapest, Váci út 12', { delay: 60 });
      await page.waitForSelector('.pac-container .pac-item');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.getByText(/✓ Koordináta:/).first()).toBeVisible();
      await expect(page.getByText(/Hiányzó vagy hibás mező/)).toHaveCount(0);
    } finally { release(); }
  });
}

test('csomagkövető: 503 hiba után újrapróbálás és tényleges adatmegjelenítés', async ({ page }) => {
  const endpoint = '**/tracking/recovery-test';
  await page.route(endpoint, route => route.fulfill({ status: 503, json: { error: 'Temporary outage' } }));
  await page.goto('/nyomon-kovetes/recovery-test');
  await expect(page.getByText('A csomagkövetés most nem elérhető')).toBeVisible();
  await expect(page.getByText('Fuvar nem található')).toHaveCount(0);
  await page.unroute(endpoint);
  await page.route(endpoint, route => route.fulfill({ json: {
    id: 'recovery-job', title: 'Helyreállt csomagkövetés', status: 'in_progress', dropoff_address: 'Szeged',
    carrier: null, last_position: null, delivery_code: null, delivered_at: null, recipient_name: null,
  } }));
  await page.getByRole('button', { name: /Újra/ }).click();
  await expect(page.getByText('Helyreállt csomagkövetés')).toBeVisible();
  await expect(page.getByText(/Utolsó frissítés:/)).toBeVisible();
});

test('csomagkövető: a beragadt kapcsolat időkorlát után újrapróbálható', async ({ page }) => {
  let release!: () => void;
  const stalled = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tracking/stalled-test', async route => {
    await stalled;
    await route.abort().catch(() => {});
  });
  try {
    await page.goto('/nyomon-kovetes/stalled-test');
    await expect(page.getByText(/A szerver nem válaszolt időben/)).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole('button', { name: /Újra/ })).toBeEnabled();
    await expect(page.getByText('Csomag keresése…')).toHaveCount(0);
  } finally { release(); }
});
