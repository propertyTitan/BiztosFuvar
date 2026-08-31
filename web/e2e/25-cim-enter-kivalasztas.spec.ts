// =====================================================================
//  CÍM-KIVÁLASZTÁS ENTERREL — DETERMINISZTIKUS (GF-007, 4. kör)
//
//  A történet: az Enter-fék háromszor „javult meg" úgy, hogy a Manus
//  újra megtalálta. A 4. körben élesben mérve derült ki, hogy a 3. körös
//  capture-fék a SUBMITOT megfogta ugyan, de a Google saját Enter-
//  kiválasztását tette NEM-DETERMINISZTIKUSSÁ (3 futásból 2-ben nem
//  választott) — a felhasználónak ez ugyanúgy „az Enter rossz".
//
//  Ez a spec a TELJES elvárást méri, ismételve (a flakiness ellen):
//   · ArrowDown+Enter után a cím MEGERŐSÍTÖTT („✓ Koordináta" látszik);
//   · NINCS korai submit (se hiba-toast, se kötelező-mező hibák).
// =====================================================================
import { test, expect } from '@playwright/test';
import { createUser, loginAs } from './helpers';

// Háromszor futtatjuk ugyanazt — a 3. körös hiba pont ismétléskor jött elő.
for (const kor of [1, 2, 3]) {
  test(`ArrowDown+Enter kiválaszt ÉS nem submitol (${kor}. ismétlés)`, async ({ page }) => {
    const felado = await createUser('shipper', `Enter Emma ${kor}`);
    await loginAs(page, felado);
    await page.goto('/dashboard/uj-fuvar');

    const cim = page.getByPlaceholder(/Budapest, Váci út/).first();
    await cim.click();
    await cim.pressSequentially('Budapest, Váci út 12', { delay: 60 });
    await page.waitForSelector('.pac-container .pac-item', { timeout: 10_000 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    // A kiválasztásnak DETERMINISZTIKUSAN meg kell történnie:
    await expect(
      page.getByText(/✓ Koordináta:/).first(),
      'Az Enter nem választotta ki a javaslatot — a cím megerősítetlen maradt, '
      + 'a felhasználó a beküldésnél kap hibaesőt („az Enter rossz").',
    ).toBeVisible({ timeout: 10_000 });

    // …és közben NEM történhetett korai submit:
    await expect(page.getByText(/Hiányzó vagy hibás mező/)).toHaveCount(0);
    await expect(page.getByText(/Kérjük, töltsd ki/)).toHaveCount(0);
  });
}
