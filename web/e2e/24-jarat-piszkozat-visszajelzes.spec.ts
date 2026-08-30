// =====================================================================
//  ÜRES JÁRAT-PISZKOZAT — EXPLICIT VISSZAJELZÉS (GF-018)
//
//  A Manus-regresszió „továbbra is néma"-t jelentett — ez a teszt a FRISS
//  buildön bizonyítja, hogy a kattintás explicit toastot ad (a #200-as
//  javítás), és őrzi, hogy vissza ne némuljon. (A hiány-lista a gombok
//  alatt eddig is ott volt, de a felhasználó a gombra néz.)
// =====================================================================
import { test, expect } from '@playwright/test';
import { createUser, loginAs } from './helpers';

test('üres űrlapon a „Mentés piszkozatként" kattintás explicit hibát ad', async ({ page }) => {
  const carrier = await createUser('carrier', 'Piszkozat Pál');
  await loginAs(page, carrier);
  await page.goto('/sofor/uj-utvonal');

  await page.getByRole('button', { name: /Mentés piszkozatként/ }).click();

  await expect(
    page.getByText(/piszkozat mentéséhez még hiányzik/i).first(),
    'Az üres piszkozat-mentés kattintása némán elveszett (GF-018).',
  ).toBeVisible();
  await expect(page.getByText(/Megnevezés/).first()).toBeVisible();
});
