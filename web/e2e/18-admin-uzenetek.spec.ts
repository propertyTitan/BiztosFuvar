// Admin ↔ user üzenetküldés a BÖNGÉSZŐBŐL (a backend-suite a szabályokat
// fedi — itt azt nézzük, hogy a FELÜLET tényleg végigviszi: composer,
// modal, válasz-mező, olvasás-visszajelzés, körüzenet-megerősítő).
import { test, expect } from '@playwright/test';
import { createUser, dbQuery, loginAs } from './helpers';

test('admin üzenetet küld a felületről → a user látja, válaszol → az admin a szálban látja', async ({ page, browser }) => {
  const admin = await createUser('admin', 'Admin Aladár');
  const cimzett = await createUser('shipper', 'Címzett Csilla');

  // ── Admin: Felhasználók fül → boríték-gomb → üzenet-modal ──
  await loginAs(page, admin);
  await page.goto('/admin#felhasznalok');
  const sor = page.locator('tr', { hasText: 'Címzett Csilla' }).first();
  await expect(sor).toBeVisible();
  await sor.locator('button[title="Üzenet küldése a felhasználónak"]').click();

  await page.getByPlaceholder(/Üzenet a felhasználónak/).fill('Szia Csilla! Ez egy admin teszt-üzenet.');
  await page.getByRole('button', { name: 'Küldés', exact: true }).click();
  await expect(page.getByText('Üzenet elküldve').first()).toBeVisible({ timeout: 20_000 });
  // Amíg a user nem nyitotta meg: "Még nem olvasta"
  await expect(page.getByText('Még nem olvasta').first()).toBeVisible();

  // ── User egy MÁSIK böngésző-kontextben: /uzenetek ──
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await loginAs(userPage, cimzett);
  await userPage.goto('/uzenetek');
  await expect(userPage.getByText('Ez egy admin teszt-üzenet')).toBeVisible();

  // Válaszolhat (a közvetlen üzenet megnyitotta a csatornát)
  await userPage.getByPlaceholder(/Írd meg a válaszod/).fill('Köszönöm, megkaptam!');
  await userPage.getByRole('button', { name: /Küldés/ }).click();
  await expect(userPage.getByText('Köszönöm, megkaptam!').first()).toBeVisible({ timeout: 20_000 });
  await userContext.close();

  // ── Admin: Üzenetek fül → a szálban ott a válasz + az olvasás-jelzés ──
  await page.goto('/admin#uzenetek');
  const szalKartya = page.locator('button.card', { hasText: 'Címzett Csilla' }).first();
  await expect(szalKartya).toBeVisible();
  // A kattintás túléli a háttér-frissítés (élő jelenlét-poll / socket) miatti
  // re-rendert: ha az első kattintás már kinyitotta a modalt, nem kattintunk
  // újra — különben a Playwright a modal-overlay mögött ragadna.
  await expect(async () => {
    if (!(await page.getByText('Köszönöm, megkaptam!').first().isVisible())) {
      await szalKartya.click({ timeout: 2000 });
    }
    await expect(page.getByText('Köszönöm, megkaptam!').first()).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/Elolvasva:/).first()).toBeVisible();
});

test('akinek az admin nem írt, nem tud üzenni: üres állapot, válasz-mező nélkül', async ({ page }) => {
  const maganyos = await createUser('shipper', 'Magányos Márta');
  await loginAs(page, maganyos);
  await page.goto('/uzenetek');

  await expect(page.getByText('Nincs üzeneted').first()).toBeVisible();
  await expect(page.locator('textarea')).toHaveCount(0);
});

test('körüzenet a composerből (céges célzás) → a céges user megkapja közleményként', async ({ page, browser }) => {
  const admin = await createUser('admin', 'Admin Aladár');
  const ceges = await createUser('shipper', 'Céges Cecil');
  // Céges célzás, hogy a párhuzamosan futó tesztek privát userei ne kapják meg
  await dbQuery(`UPDATE users SET account_type = 'company' WHERE id = $1`, [ceges.id]);

  await loginAs(page, admin);
  await page.goto('/admin#uzenetek');
  await page.locator('#bc-target').selectOption('company');
  await page.getByPlaceholder(/A közlemény szövege/).fill('Céges hír: elérhető a NAV-os cégjelvény.');
  await page.getByRole('button', { name: /Körüzenet küldése/ }).click();

  // Megerősítő dialógus → Küldés
  await expect(page.getByText(/Körüzenet — Céges fiókok/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Küldés', exact: true }).click();
  await expect(page.getByText('Körüzenet kiment').first()).toBeVisible({ timeout: 20_000 });

  // A céges user közleményként kapja, válasz-lehetőség NÉLKÜL
  const userContext = await browser.newContext();
  const userPage = await userContext.newPage();
  await loginAs(userPage, ceges);
  await userPage.goto('/uzenetek');
  await expect(userPage.getByText('Céges hír: elérhető a NAV-os cégjelvény.')).toBeVisible();
  await expect(userPage.getByText('GoFuvar közlemény').first()).toBeVisible();
  await expect(userPage.locator('textarea')).toHaveCount(0);
  await userContext.close();
});
