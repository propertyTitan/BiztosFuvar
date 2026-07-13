// Mobil vízszintes túlcsordulás — OSZTÁLY-teszt.
//
// A hiba-osztály: egy dekor-elem (glow, chip, abszolút pozíció) szélesebbre
// nyújtja a dokumentumot a viewportnál → mobilon ki lehet zoomolni, a
// tartalom a kijelző ~2/3-áig ér, az oldal "olcsónak" érződik (2026-07-13-i
// user-jelzés). A globals.css `html, body { overflow-x: clip }` védi; ez a
// teszt azt őrzi, hogy senki ne vegye ki, és új túlcsordulás se szülessen.
import { test, expect } from '@playwright/test';

// Publikus, auth nélküli oldalak — a landing a legdekoráltabb, a többi a
// sablonokat (LandingTemplate, űrlap) fedi.
const PAGES = ['/', '/bejelentkezes', '/fuvarozoknak', '/butorszallitas'];

test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12/13/14 méret

for (const path of PAGES) {
  test(`nincs vízszintes túlcsordulás mobilon: ${path}`, async ({ page }) => {
    await page.goto(path);
    // A hero-animációk/betöltés lefutása után mérünk
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    const { scrollW, clientW } = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }));
    // +1px tolerancia a subpixel-kerekítésre
    expect(scrollW, `${path}: a dokumentum (${scrollW}px) szélesebb a viewportnál (${clientW}px) — valami kilóg`).toBeLessThanOrEqual(clientW + 1);
  });
}
