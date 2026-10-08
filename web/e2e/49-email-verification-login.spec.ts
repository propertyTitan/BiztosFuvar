import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { createUser, dbQuery } from './helpers';

const confirmation = 'Az e-mail-címedet sikeresen megerősítettük. Bejelentkezhetsz!';

test('email linkje belépés nélküli böngészőben is a belépési űrlapra visz, ismételt megnyitáskor is', async ({ page }) => {
  const user = await createUser('shipper');
  const token = randomBytes(32).toString('hex');
  await dbQuery('UPDATE users SET email_verified = false, email_verification_token_hash = $1 WHERE id = $2', [
    createHash('sha256').update(token).digest('hex'), user.id,
  ]);
  await page.addInitScript(() => localStorage.setItem('gofuvar_cookie_consent', JSON.stringify({ necessary: true })));
  await page.setViewportSize({ width: 390, height: 844 });
  for (let visit = 0; visit < 2; visit++) {
    await page.goto(`/email-megerositese?token=${token}`);
    await page.waitForURL(/\/bejelentkezes\?mode=login&email_verified=1$/);
    await expect(page.getByRole('status').filter({ hasText: confirmation })).toBeVisible();
    await expect(page.getByLabel('E-mail-cím', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Jelszó', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Teljes név', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect((await dbQuery('SELECT email_verified FROM users WHERE id = $1', [user.id])).rows[0].email_verified).toBe(true);
  await page.getByLabel('E-mail-cím', { exact: true }).fill(user.email);
  await page.getByLabel('Jelszó', { exact: true }).fill('Jelszo123!');
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Erősítsd meg az e-mail-címed' })).toHaveCount(0);
});

for (const suffix of ['', '?token=ervenytelen-link']) {
  test(`hibás megerősítő linknél nincs sikeres visszajelzés vagy automatikus továbblépés: ${suffix || 'hiányzó token'}`, async ({ page }) => {
    await page.goto(`/email-megerositese${suffix}`);
    await expect(page.getByRole('heading', { name: 'A megerősítés nem sikerült' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/email-megerositese${suffix.replace('?', '\\?')}$`));
    await expect(page.getByText(confirmation)).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('link', { name: 'Bejelentkezés', exact: true })).toHaveAttribute('href', '/bejelentkezes');
  });
}
