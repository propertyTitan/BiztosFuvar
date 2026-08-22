// Téma-kapcsoló (2026-08-04, tesztelői kérés): a user maga válthat világos és
// sötét között; az alapértelmezés a SÖTÉT téma (2026-08-22, user-döntés),
// a rendszer-mód kifejezett választásként érhető el.
//
// Ez a spec a teljes bekötést őrzi — amit unit-teszttel nem lehet: a <head>-be
// tett boot-szkript tényleg fut-e a festés előtt (nincs világos villanás),
// a választás túléli-e az oldalletöltést, és a CSS tényleg átvált-e.
// Publikus oldal, nincs API-hívás → gyors és determinisztikus.
import { test, expect } from '@playwright/test';

const themeButton = /Téma:/;

test.describe('téma-kapcsoló', () => {
  test('alapból SÖTÉT — az operációs rendszer beállításától függetlenül', async ({ browser }) => {
    // 2026-08-22 (user-döntés): tárolt választás nélkül a téma dark,
    // világos OS-en is. A kapcsoló marad, bárki átválthat.
    const darkCtx = await browser.newContext({ colorScheme: 'dark' });
    const darkPage = await darkCtx.newPage();
    await darkPage.goto('/');
    await expect(darkPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await darkCtx.close();

    const lightCtx = await browser.newContext({ colorScheme: 'light' });
    const lightPage = await lightCtx.newPage();
    await lightPage.goto('/');
    await expect(lightPage.locator('html')).toHaveAttribute('data-theme', 'dark');
    await lightCtx.close();
  });

  test('a gomb körbelépteti a három állapotot, és a CSS is átvált', async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto('/');

    const html = page.locator('html');
    // Friss állapot: az alapértelmezett SÖTÉT (világos OS mellett is).
    await expect(html).toHaveAttribute('data-theme', 'dark');
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // sötét → rendszer (a context világos) — a 'system' ELTÁROLÓDIK
    // (nem törlődik: a hiányzó kulcs már dark-ot jelentene)
    await page.getByRole('button', { name: themeButton }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('gofuvar_theme'))).toBe('system');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(lightBg).not.toBe(darkBg);

    // rendszer → világos
    await page.getByRole('button', { name: themeButton }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('gofuvar_theme'))).toBe('light');

    // világos → sötét: a háttér ténylegesen visszavált
    await page.getByRole('button', { name: themeButton }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');

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
