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
//  ⚠️ Csak a MARKETING/publikus oldalakra fut. A jogi oldalak (ÁSZF,
//  adatkezelési) szándékosan használnak olyan szavakat tagadó szerkezetben,
//  amik itt tiltottak (pl. „a fuvardíjat nem tartja letétben") — azok
//  szövegét ügyvédi review nézi át, nem ez a teszt.
// =====================================================================
import { test, expect } from '@playwright/test';

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
];

type Rule = { pattern: RegExp; miert: string };

const TILTOTT: Rule[] = [
  {
    pattern: /GoFuvar\s+Kft/i,
    miert: 'Nincs ilyen cég — az üzemeltető a Tiszta Hód Kft. (CLAUDE.md 4.)',
  },
  {
    pattern: /letét/i,
    miert: 'Escrow-kori szöveg. 2026-07-03 óta a fuvardíj közvetlenül a felek közt megy.',
  },
  {
    pattern: /\blicit(?!jeim)/i,
    miert: 'PR #71: user felé „ajánlat/ajánlattétel", a „licit" árverést sugall.',
  },
  {
    pattern: /jogosítvány/i,
    miert: 'A „jogosítvány nem kell" marketingben TILOS — ne hívjuk fel rá a figyelmet.',
  },
  {
    pattern: /olcsóbb,?\s+mint\s+egy\s+(dedikált|hagyományos)/i,
    miert: 'PR #64: tiltott összehasonlítás — helyette verseny-alapú megfogalmazás.',
  },
  {
    pattern: /te\s+szabod\s+az\s+árat/i,
    miert: 'PR #63: a szállító ad ajánlatot, a feladó dönt — nem a feladó szabja az árat.',
  },
  {
    pattern: /\bQR\b/i,
    miert: 'A QR kód 2026-08-06-án kikerült (user-döntés) — csak a 6 jegyű PIN van.',
  },
  {
    pattern: /(app\s*store|google\s*play)/i,
    miert: 'NINCS mobilapp — app-ígéret tilos (CLAUDE.md, PR #62).',
  },
  {
    pattern: /(töltsd le|letöltheted).{0,25}(appot|alkalmazást)/i,
    miert: 'NINCS mobilapp — letöltésre buzdítás tilos.',
  },
];

test.describe('szövegőr: tiltott kifejezések a marketing-oldalakon', () => {
  for (const oldal of MARKETING_PAGES) {
    test(`tiszta szöveg: ${oldal}`, async ({ page }) => {
      await page.goto(oldal, { waitUntil: 'domcontentloaded' });
      // A süti-banner és a teszt-banner is szöveg — azok is beleszámítanak,
      // szándékosan: a user azokat is olvassa.
      const szoveg = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

      const talalatok = TILTOTT
        .filter((r) => r.pattern.test(szoveg))
        .map((r) => {
          const m = szoveg.match(r.pattern);
          const idx = m?.index ?? 0;
          const kornyezet = szoveg.slice(Math.max(0, idx - 60), idx + 80);
          return `  ✗ "${m?.[0]}" — ${r.miert}\n     Környezet: …${kornyezet}…`;
        });

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
