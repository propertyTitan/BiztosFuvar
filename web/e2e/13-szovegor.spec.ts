// =====================================================================
//  SZÖVEGŐR — a marketing-oldalak tiltott szavai
//
//  A CLAUDE.md szöveg-szabályai már TÖBBSZÖR visszacsúsztak a kódba
//  (a „licit" purge után maradtak helyek; a „Letét." szlogen az OG-képen
//  ragadt bent hónapokig; a nem létező „GoFuvar Kft." az email-fejlécben).
//  Ezek nem kód-hibák, ezért semmilyen unit-teszt nem fogja meg őket —
//  csak az veszi észre, aki épp elolvassa az oldalt.
//
//  Ez a spec a MEGJELENÍTETT szöveget nézi (nem a forrást), tehát az
//  i18n-ből, az API-ból vagy egy komponensből érkező szöveget is elkapja.
//
//  ⚠️ Csak a MARKETING/publikus oldalakra fut a TELJES lista. A jogi oldalak
//  (ÁSZF, adatkezelési) szándékosan használnak olyan szavakat tagadó
//  szerkezetben, amik itt tiltottak (pl. „a fuvardíjat nem tartja
//  letétben") — azok szövegét ügyvédi review nézi át, nem ez a teszt.
//
//  UX A05 (2026-10-08): a szabályok közös modulba kerültek
//  (szovegor-szabalyok.ts). A „mindenhol” jelölt részhalmaz a belépett
//  felületeken is fut (16-os spec, az oldal-leltár minden állapotán) és a
//  forrás-őrben (src/lib/szovegor-forras.test.ts) — az app-ígéret és a
//  „jogosítvány nem szükséges” ugyanis a belépett oldalakon csúszott át.
// =====================================================================
import { test, expect } from '@playwright/test';
import { TILTOTT, szovegorTalalatok } from './szovegor-szabalyok';

/** Publikus marketing-oldalak — ezeket látja a leendő felhasználó. */
const MARKETING_PAGES = [
  '/',
  '/fuvarozoknak',
  '/soforoknek',
  '/webshopoknak',
  '/butorszallitas',
  '/koltoztetes',
  '/ikea-behozatal',
  '/marketplace-elhozas',
  '/nagygep-szallitas',
  '/autoszallitas',
  '/hozasd-el',
  '/fuvar/budapest-szeged',
  // A CIB vásárlói tájékoztatója (CIB PR-3) — publikus, a leendő feladó
  // olvassa; a banki sablon „biztonságos fizetés"-szerű fordulatai itt sem
  // csúszhatnak vissza.
  '/bankkartyas-fizetes',
];

test.describe('szövegőr: tiltott kifejezések a marketing-oldalakon', () => {
  for (const oldal of MARKETING_PAGES) {
    test(`tiszta szöveg: ${oldal}`, async ({ page }) => {
      await page.goto(oldal, { waitUntil: 'domcontentloaded' });
      // A süti-banner és a teszt-banner is szöveg — azok is beleszámítanak,
      // szándékosan: a user azokat is olvassa.
      const szoveg = await page.locator('body').innerText();
      const talalatok = szovegorTalalatok(szoveg, TILTOTT);

      expect(
        talalatok,
        `TILTOTT SZÖVEG a(z) ${oldal} oldalon:\n${talalatok.join('\n')}`,
      ).toEqual([]);
    });
  }

  test('a lábléc a valódi üzemeltetőt nevezi meg', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const footer = await page.locator('footer').innerText();
    expect(
      footer,
      'A láblécben az üzemeltető cégnevének kell szerepelnie (Tiszta Hód Kft.)',
    ).toMatch(/Tiszta\s+Hód/i);
  });
});

// ⚠️ A PWA-MANIFESZT NEM OLDAL — és pont ezért maradt ki minden korábbi
// szöveg-sweepből (2026-08-09, 2. audit-kör). A `description` mezője egyszerre
// sértett négy szabályt („sofőrök", „licitálnak", „fix áras útvonal",
// „Barion letét"), és hirdetett egy nem létező funkciót („élő GPS követés") —
// miközben ez a szöveg a telepítéskor és az app-info felületeken jelenik meg.
test('tiszta szöveg: PWA-manifeszt', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok(), 'a manifest nem érhető el').toBeTruthy();
  const manifest = await res.text();

  const talalatok = TILTOTT
    .filter((szabaly) => szabaly.pattern.test(manifest))
    .map((szabaly) => `„${szabaly.pattern}" — ${szabaly.miert}`);

  expect(
    talalatok,
    `TILTOTT KIFEJEZÉS a PWA-manifesztben:\n${talalatok.join('\n')}`,
  ).toEqual([]);
});
