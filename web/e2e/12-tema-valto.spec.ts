// Téma-kapcsoló (2026-08-04, tesztelői kérés): a user maga válthat világos és
// sötét között, a rendszer-beállítás marad az alapértelmezés.
//
// Ez a spec a teljes bekötést őrzi — amit unit-teszttel nem lehet: a <head>-be
// tett boot-szkript tényleg fut-e a festés előtt (nincs világos villanás),
// a választás túléli-e az oldalletöltést, és a CSS tényleg átvált-e.
// Publikus oldal, nincs API-hívás → gyors és determinisztikus.
import { test, expect } from '@playwright/test';

const themeButton = /Téma:/;

test.describe('téma-kapcsoló', () => {
  test('alapból az operációs rendszer beállítását követi', async ({ browser }) => {
    const darkCtx = await browser.newContext({ colorScheme: 'dark' });
    const darkPage = await darkCtx.newPage();
    await darkPage.goto('/');
    await expect(darkPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await darkCtx.close();

    const lightCtx = await browser.newContext({ colorScheme: 'light' });
    const lightPage = await lightCtx.newPage();
    await lightPage.goto('/');
    await expect(lightPage.locator('html')).toHaveAttribute('data-theme', 'light');
    await lightCtx.close();
  });

  test('a gomb körbelépteti a három állapotot, és a CSS is átvált', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // rendszer(világos) → világos
    await page.getByRole('button', { name: themeButton }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // világos → sötét: a háttér ténylegesen megváltozik
    await page.getByRole('button', { name: themeButton }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(darkBg).not.toBe(lightBg);

    // sötét → rendszer (a context világos) — a mentett választás törlődik
    await page.getByRole('button', { name: themeButton }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('gofuvar_theme'))).toBeNull();

    await ctx.close();
  });

  test('a választott téma túléli az újratöltést, villanás nélkül', async ({ browser }) => {
    // Világos OS + kézzel választott sötét: ha a boot-szkript nem futna a
    // festés előtt, az oldal egy pillanatra világosan jelenne meg.
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('gofuvar_theme', 'dark'));
    await page.goto('/aszf');

    // Az attribútum már a legelső dokumentum-állapotban ott van
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await ctx.close();
  });
});
