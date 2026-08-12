// =====================================================================
//  HALOTT LINKEK — a RENDERELT felületen, nem a forrásszövegben (2026-08-12)
//
//  A tesztelő kérdése: „broken links 0?"
//
//  Volt már link-őrünk (`src/lib/linkIntegrity.test.ts`), de a hatóköre
//  szűkebb, mint amit a kérdés jelent. Az a teszt a `.tsx` FORRÁSFÁJLOKAT
//  olvassa, és a bennük lévő STATIKUS `href="/..."` mintákat egyezteti az
//  `app/` könyvtárral. Amit ezért NEM lát:
//
//    (1) az ADAT-VEZÉRELT linkeket — a `src/lib/landings.ts` egy .ts fájl
//        (nem .tsx), és a SEO-landingek linkjeit adatból rendereljük;
//    (2) a template-literálos, dinamikus linkeket (`/fuvar/${slug}`);
//    (3) a KÜLSŐ hivatkozásokat (jogszabály, hatóság, partner);
//    (4) a horgony-linkeket (`#szakasz`), amiknek nincs céljuk az oldalon;
//    (5) azt, hogy a cél VALÓBAN betölt-e — az App Router-fájl LÉTEZÉSE nem
//        garantálja, hogy az oldal nem 404-es állapotot renderel.
//
//  Ez a spec a másik irányból nézi: MEGNYITJA az oldalt egy böngészőben, és
//  összegyűjti azt, amit a felhasználó tényleg lát és kattinthat. Egy link
//  akkor halott, ha rákattintva a felhasználó zsákutcába jut.
//
//  ⚠️ KÜLSŐ LINKEK: a hálózat elérése a CI-ban flaky lenne (rate limit,
//  hatósági oldalak lassúsága), ezért a külső hivatkozásokat NEM töltjük le.
//  Amit viszont mérünk rajtuk, az a SAJÁT hibáink osztálya: elgépelt séma
//  (`htp://`), szóköz az URL-ben, üres `href`, és a `target="_blank"`
//  melletti hiányzó `rel="noopener"` (az utóbbi biztonsági, nem esztétikai:
//  a megnyitott oldal a `window.opener`-en át visszanyúlhat a mi lapunkra).
// =====================================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs } from './helpers';
import { OLDALAK, keszitsFixtures, Fixtures } from './oldal-leltar';

type Link = {
  honnan: string;
  href: string;
  szoveg: string;
  ujAblak: boolean;
  rel: string;
};

/** Amit nem tekintünk navigációs linknek. */
function navigacios(href: string): boolean {
  if (!href) return false;
  return !/^(mailto:|tel:|javascript:|data:|blob:)/i.test(href);
}

// ⚠️ A begyűjtés és az ellenőrzés KÉT külön teszt. A közös állapot ezért
// FÁJLBAN él, nem modul-szintű változóban — a Playwright ugyanis BUKÁS UTÁN
// ÚJRAINDÍTJA a worker-folyamatot, és a memóriában tartott gyűjtés ilyenkor
// elveszik. A 19-es specnél ezt élesben lemértem: négy oldal elbukott, az
// összegzés mégis „nincs sértés"-t írt. Itt a hiba még súlyosabb lenne, mert
// az ÜRES gyűjtés a mi állításainkban épp a SIKER jele („nincs halott link").
// Ezért az ellenőrző teszt külön meg is követeli, hogy legyen mit ellenőrizni.
test.describe.configure({ mode: 'serial' });

const NAPLO = path.join(__dirname, '..', 'test-results', 'linkek.jsonl');
let F: Fixtures;

type Bejegyzes =
  | { fajta: 'belso'; utvonal: string; honnan: string }
  | { fajta: 'kulso'; link: Link }
  | { fajta: 'gyanus'; uzenet: string };

function naplozz(b: Bejegyzes) {
  fs.mkdirSync(path.dirname(NAPLO), { recursive: true });
  fs.appendFileSync(NAPLO, `${JSON.stringify(b)}\n`);
}

function naploOlvas(): Bejegyzes[] {
  if (!fs.existsSync(NAPLO)) return [];
  return fs.readFileSync(NAPLO, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// A napló törlése a globalSetup-ban történik — lásd az ottani indoklást.
test.beforeAll(async () => { F = await keszitsFixtures(); });

/** Egy oldal összes kattintható hivatkozásának begyűjtése. */
async function gyujtsLinkeket(page: Page, honnan: string): Promise<Link[]> {
  return page.$$eval('a[href]', (elemek) => elemek.map((a) => {
    const el = a as HTMLAnchorElement;
    return {
      href: el.getAttribute('href') || '',
      szoveg: (el.textContent || '').trim().slice(0, 60),
      ujAblak: el.getAttribute('target') === '_blank',
      rel: el.getAttribute('rel') || '',
    };
  })).then((lista) => lista.map((l) => ({ ...l, honnan })));
}

test.describe('halott linkek: begyűjtés a renderelt oldalakról', () => {
  test.setTimeout(240_000);

  for (const oldal of OLDALAK) {
    test(`linkek begyűjtése: ${oldal.minta}${oldal.allapot ? ' [állapot]' : ''}`, async ({ page }) => {
      if (oldal.szereplo !== 'anon') {
        await loginAs(page, F[oldal.szereplo]);
      }
      await page.goto(oldal.url(F));
      await page.waitForLoadState('networkidle').catch(() => {});
      if (oldal.allapot) await oldal.allapot(page);

      for (const link of await gyujtsLinkeket(page, oldal.minta)) {
        const { href } = link;
        if (!navigacios(href)) continue;

        // Nyilvánvalóan elrontott hivatkozások — ezek a MI hibáink.
        if (href.trim() === '' || href === '#' || /\s/.test(href)) {
          naplozz({ fajta: 'gyanus', uzenet: `${oldal.minta}: üres vagy szóközös href — "${href}" (szöveg: "${link.szoveg}")` });
          continue;
        }
        if (/^ht?tps?:\/\//i.test(href) === false && /^[a-z]+:\/\//i.test(href)) {
          naplozz({ fajta: 'gyanus', uzenet: `${oldal.minta}: ismeretlen protokoll — "${href}"` });
          continue;
        }

        if (/^https?:\/\//i.test(href)) {
          naplozz({ fajta: 'kulso', link });
          continue;
        }
        if (href.startsWith('#')) continue; // horgony, külön kezelendő

        const utvonal = href.split('#')[0].split('?')[0];
        if (!utvonal || utvonal === '/') continue;
        naplozz({ fajta: 'belso', utvonal, honnan: oldal.minta });
      }
    });
  }
});

test.describe('halott linkek: a célok tényleges ellenőrzése', () => {
  test.setTimeout(300_000);

  test('MINDEN belső link célja betölt (nem 404, nem hibaállapot)', async ({ page }) => {
    const belsoLinkek = new Map<string, Set<string>>();
    for (const b of naploOlvas()) {
      if (b.fajta !== 'belso') continue;
      if (!belsoLinkek.has(b.utvonal)) belsoLinkek.set(b.utvonal, new Set());
      belsoLinkek.get(b.utvonal)!.add(b.honnan);
    }

    expect(
      belsoLinkek.size,
      'Egyetlen belső linket sem gyűjtöttünk be — a mérés vak. Vagy a\n'
      + 'begyűjtő tesztek nem futottak le előbb, vagy a szelektor romlott el.',
    ).toBeGreaterThan(10);

    const halottak: string[] = [];

    for (const [utvonal, honnanHalmaz] of belsoLinkek) {
      const valasz = await page.goto(utvonal, { waitUntil: 'domcontentloaded' })
        .catch(() => null);

      const statusz = valasz?.status() ?? 0;
      // A Next.js a nem létező útvonalra 404-es STÁTUSSZAL válaszol, de a
      // dinamikus szegmensek (pl. törölt fuvar azonosítója) 200-at adhatnak
      // a saját „nem található" nézetükkel — ezért a látható tartalmat is
      // megnézzük, nem csak a státuszkódot.
      const szoveg = await page.locator('body').innerText().catch(() => '');
      const nemTalalhato = /Az oldal nem található|404\s*[—–-]|Page not found/i.test(szoveg);

      const honnan = [...honnanHalmaz].join(', ');
      if (statusz >= 400 || nemTalalhato) {
        halottak.push(`${utvonal} → ${statusz || 'nem tölt be'}${nemTalalhato ? ' (404-oldal)' : ''}  [innen: ${honnan}]`);
      }
    }

    expect(
      halottak,
      `HALOTT BELSŐ LINK(EK) a felületen:\n  ${halottak.join('\n  ')}\n\n`
      + 'A felhasználó rákattint és zsákutcába jut. A meglévő\n'
      + '`linkIntegrity.test.ts` ezeket NEM feltétlenül látja: az a\n'
      + 'FORRÁSFÁJLOK statikus href-jeit egyezteti az app/ könyvtárral, tehát\n'
      + 'az adat-vezérelt (landings.ts) és a dinamikus linkeket nem fedi — és\n'
      + 'a fájl LÉTEZÉSE nem garantálja, hogy az oldal nem 404-et renderel.',
    ).toEqual([]);
  });

  test('a külső hivatkozások alakja helyes, és noopener védi őket', async () => {
    const kulsoLinkek = naploOlvas()
      .filter((b): b is Extract<Bejegyzes, { fajta: 'kulso' }> => b.fajta === 'kulso')
      .map((b) => b.link);

    expect(
      kulsoLinkek.length,
      'Egyetlen külső linket sem gyűjtöttünk be — a mérés vak lenne, mert az '
      + 'üres lista a lenti állításokban épp a SIKER jele.',
    ).toBeGreaterThan(0);

    const rosszAlak = kulsoLinkek.filter((l) => {
      try {
        const u = new URL(l.href);
        return !['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.');
      } catch {
        return true;
      }
    });

    expect(
      rosszAlak.map((l) => `${l.honnan}: "${l.href}"`),
      'ÉRTELMEZHETETLEN KÜLSŐ URL. Jellemzően elgépelés (`htp://`, hiányzó\n'
      + 'pont a hosztban). A hálózatot szándékosan nem hívjuk — ez a saját\n'
      + 'hibáink osztálya, ami hálózat nélkül is kimutatható.',
    ).toEqual([]);

    // A `target="_blank"` melletti hiányzó `rel="noopener"` biztonsági rés:
    // a megnyitott oldal a `window.opener`-en át átirányíthatja a MI lapunkat
    // (tabnabbing) — a felhasználó a saját fülére visszatérve egy hamis
    // bejelentkező oldalt találhat.
    const vedtelen = kulsoLinkek.filter(
      (l) => l.ujAblak && !/noopener|noreferrer/.test(l.rel),
    );

    expect(
      vedtelen.map((l) => `${l.honnan}: "${l.href}" (szöveg: "${l.szoveg}")`),
      'ÚJ ABLAKBAN NYÍLÓ KÜLSŐ LINK `rel="noopener"` NÉLKÜL.\n\n'
      + 'A megnyitott oldal a `window.opener`-en át átirányíthatja a MI\n'
      + 'lapunkat (tabnabbing): a felhasználó visszatér a fülére, és egy\n'
      + 'GoFuvar-nak látszó, hamis bejelentkező oldalt talál. A modern\n'
      + 'böngészők többsége már alapból véd, de a régebbiek nem — és a\n'
      + 'javítás egyetlen attribútum.',
    ).toEqual([]);
  });

  test('a gyűjtés közben nem találtunk nyilvánvalóan elrontott hivatkozást', () => {
    const gyanusak = naploOlvas()
      .filter((b): b is Extract<Bejegyzes, { fajta: 'gyanus' }> => b.fajta === 'gyanus')
      .map((b) => b.uzenet);

    expect(
      gyanusak,
      `ELRONTOTT HIVATKOZÁS(OK):\n  ${gyanusak.join('\n  ')}\n\n`
      + 'Üres href, szóközt tartalmazó URL vagy ismeretlen protokoll. Ezek\n'
      + 'jellemzően elgépelésből vagy félbehagyott szerkesztésből maradnak.',
    ).toEqual([]);
  });
});
