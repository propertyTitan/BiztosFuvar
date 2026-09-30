// Mobil vízszintes túlcsordulás — OSZTÁLY-teszt.
//
// A hiba-osztály: egy dekor-elem (glow, chip, abszolút pozíció) szélesebbre
// nyújtja a dokumentumot a viewportnál → mobilon ki lehet zoomolni, a
// tartalom a kijelző ~2/3-áig ér, az oldal "olcsónak" érződik (2026-07-13-i
// user-jelzés). A globals.css `html, body { overflow-x: clip }` védi; ez a
// teszt azt őrzi, hogy senki ne vegye ki, és új túlcsordulás se szülessen.
import { test, expect, type Page } from '@playwright/test';

// Publikus, auth nélküli oldalak — a landing a legdekoráltabb, a többi a
// sablonokat (LandingTemplate, űrlap) fedi. A CIB PR-3 két új oldala is ide
// tartozik: a banki tájékoztató (logósorok, hosszú szöveg) és a fizetési
// eredményoldal (a hibás-link állapota API-hívás nélkül renderel).
const PAGES = [
  '/', '/bejelentkezes', '/fuvarozoknak', '/butorszallitas',
  '/bankkartyas-fizetes', '/fizetes/eredmeny?hiba=link',
];

test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12/13/14 méret

async function merjTulcsordulast(page: Page, cimke: string) {
  // A hero-animációk/betöltés lefutása után mérünk
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  // +1px tolerancia a subpixel-kerekítésre
  expect(scrollW, `${cimke}: a dokumentum (${scrollW}px) szélesebb a viewportnál (${clientW}px) — valami kilóg`).toBeLessThanOrEqual(clientW + 1);
}

for (const path of PAGES) {
  test(`nincs vízszintes túlcsordulás mobilon: ${path}`, async ({ page }) => {
    await page.goto(path);
    await merjTulcsordulast(page, path);
  });
}

// Az eredményoldal leghosszabb állapota: a sikeres fizetés a bank által
// kötelezővé tett öt adatsorral (hosszú feliratok + 16 jegyű TrID). Az
// E2E-backend CIB nélkül fut, ezért a választ a böngészőben helyettesítjük
// (az oldal-leltár cibEredmenyAllapot mintájára).
test('nincs vízszintes túlcsordulás mobilon: /fizetes/eredmeny (sikeres, banki adatsorral)', async ({ page }) => {
  await page.route('**/payments/cib/eredmeny**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      allapot: 'sikeres', trid: '1234567812345678', rc: '00', rt: 'Sikeres tranzakció',
      amo: 500, cur: 'HUF', anum: 'AB1234', rc_csoport: null, job_id: null,
      ujra_fizetheto: false, frissult: null,
    }),
  }));
  await page.goto('/fizetes/eredmeny?e=teszt-token');
  await expect(page.getByRole('heading', { name: /Sikeres fizetés/ })).toBeVisible();
  await merjTulcsordulast(page, '/fizetes/eredmeny (sikeres)');
});
