// =====================================================================
//  AKADÁLYMENTESÍTÉS — axe-core MINDEN oldalon (2026-08-12)
//
//  A tesztelő kérdése: „0 critical és 0 serious violation?"
//
//  Erre a projektnek eddig NEM VOLT VÁLASZA: akadálymentesítési mérés
//  egyáltalán nem futott. A 08-kontraszt-audit egy saját, kézzel írt
//  kontraszt-számoló — az egyetlen WCAG-kritériumot fedte a sok közül, és
//  a szabvány-szintű besorolást (minor/moderate/serious/critical) nem
//  ismerte. Ezért „0 critical / 0 serious" ÁLLÍTÁSA mérés nélkül nem lett
//  volna igaz állítás, csak remény.
//
//  Ez a spec a de facto ipari szabványt (axe-core) futtatja le a KÖZÖS
//  oldal-leltár minden oldalán, a hozzá tartozó szereplővel bejelentkezve —
//  tehát a bejelentkezés mögötti felületeket is méri, nem csak a landingeket.
//
//  ── MI BUKTATJA EL A BUILDET ─────────────────────────────────────────
//  A `critical` és a `serious` sértés. A `moderate`/`minor` NEM: azokat
//  kiírjuk a riportba, de nem kapuzunk rájuk. Ok: a moderate többsége
//  ízlés- vagy szerkezet-kérdés (landmark-régiók, címsor-sorrend), és ha
//  arra is kapuznánk, a csapat hozzászokna a piros buildhez — pontosan az a
//  hozzászokás, ami a valódi, súlyos hibát is átengedi.
//
//  ── AMIT SZÁNDÉKOSAN NEM MÉRÜNK ──────────────────────────────────────
//  A `color-contrast` szabály itt KI VAN KAPCSOLVA — nem azért, mert nem
//  fontos, hanem mert a 08-kontraszt-audit ALAPOSABBAN méri: a téma-váltót
//  is végigjárja (világos ÉS sötét mód), amit az axe egy futásban nem lát.
//  Két mérés ugyanarra, ahol az egyik gyengébb, csak zajt adna.
// =====================================================================
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs } from './helpers';
import {
  OLDALAK, keszitsFixtures, varjStabilOldalt, Fixtures,
} from './oldal-leltar';

// ⚠️ MIÉRT FÁJL, ÉS NEM MODUL-SZINTŰ TÖMB (2026-08-12, mért tapasztalat):
// a Playwright BUKÁS UTÁN ÚJRAINDÍTJA a worker-folyamatot, tehát a modul-
// szintű állapot elveszik. Az első változatom pont ezért írt „nincs sértés"
// összegzést, MIKÖZBEN négy oldal elbukott — vagyis a riport akkor hazudott
// volna a legnagyobbat, amikor a legnagyobb szükség lett volna rá.
// Ugyanaz a vakon-zöld osztály, amivel a projekt már többször találkozott:
// az állítás nem azt mérte, amit mérni akart.
const NAPLO = path.join(__dirname, '..', 'test-results', 'axe-sertesek.jsonl');

/** Amire kapuzunk. Az axe négy szintje: minor < moderate < serious < critical. */
const KAPUZOTT_SZINTEK = ['critical', 'serious'] as const;

/**
 * Szabály-kivételek ÍRÁSOS INDOKKAL. Üresen indul — és maradjon is az.
 * Aki ide vesz fel sort, annak meg kell indokolnia, MIÉRT nem javítható a
 * hiba maga. A puszta „sok munka" nem indok; a „harmadik fél iframe-je,
 * amire nincs ráhatásunk" igen.
 */
const SZABALY_KIVETELEK: Record<string, string> = {
  // A kontrasztot a 08-kontraszt-audit méri, mindkét témában — lásd a fejlécet.
  'color-contrast': 'A 08-kontraszt-audit alaposabban méri (világos ÉS sötét mód).',
};

type Sertes = {
  oldal: string;
  szabaly: string;
  szint: string;
  darab: number;
  leiras: string;
  elsoElem: string;
  segitseg: string;
};

let F: Fixtures;

function naplozz(s: Sertes) {
  fs.mkdirSync(path.dirname(NAPLO), { recursive: true });
  fs.appendFileSync(NAPLO, `${JSON.stringify(s)}\n`);
}

function naploOlvas(): Sertes[] {
  if (!fs.existsSync(NAPLO)) return [];
  return fs.readFileSync(NAPLO, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ⚠️ A napló törlése SZÁNDÉKOSAN a globalSetup-ban van, NEM itt: a
// `beforeAll` a worker újraindulásakor (= minden bukás után) újra lefutna,
// és pont a bukás után törölné ki az addig gyűjtött bizonyítékot.
test.beforeAll(async () => { F = await keszitsFixtures(); });

test.describe('akadálymentesítés: axe-core minden oldalon', () => {
  // Az 51 oldal végigjárása böngészőben lassú — bőven adunk időt.
  test.setTimeout(240_000);

  for (const oldal of OLDALAK) {
    test(`axe: ${oldal.minta}${oldal.allapot ? ' [állapot]' : ''} (${oldal.szereplo})`, async ({ page }) => {
      if (oldal.szereplo !== 'anon') {
        await loginAs(page, F[oldal.szereplo]);
      }

      await page.goto(oldal.url(F));
      // A kliens-oldali lekérések befejezésére ÉS az esetleges átirányítás
      // lezajlására várunk — enélkül az axe-elemzés menet közben szállna el
      // („Execution context was destroyed"), ahogy a CI-ban meg is tette.
      await varjStabilOldalt(page);

      // Interakcióval feltáruló állapot (pl. szerkesztő-űrlap) megnyitása.
      if (oldal.allapot) await oldal.allapot(page);

      const elemez = () => new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .disableRules(Object.keys(SZABALY_KIVETELEK))
        .analyze();

      let eredmeny;
      try {
        eredmeny = await elemez();
      } catch (err) {
        // Egy KÉSŐI átirányítás (pl. az auth-ellenőrzés befejeztével) elsöpörheti
        // a végrehajtási környezetet az elemzés közben. A megállapodás bevárása
        // után egyszer újrapróbáljuk. KÉTSZERI elszállásnál viszont elbukunk:
        // a néma újrapróbálkozás-ciklus pont az a hamis zöld lenne, ami ellen
        // az egész mérés szól.
        if (!/Execution context was destroyed/i.test(String(err))) throw err;
        await varjStabilOldalt(page);
        eredmeny = await elemez();
      }

      for (const v of eredmeny.violations) {
        naplozz({
          oldal: oldal.minta,
          szabaly: v.id,
          szint: v.impact || 'ismeretlen',
          darab: v.nodes.length,
          leiras: v.help,
          elsoElem: (v.nodes[0]?.html || '').slice(0, 160),
          segitseg: v.helpUrl,
        });
      }

      const sulyos = eredmeny.violations.filter(
        (v) => KAPUZOTT_SZINTEK.includes(v.impact as never),
      );

      expect(
        sulyos.map((v) => `${v.impact}: ${v.id} (${v.nodes.length} elem) — ${v.help}\n`
          + `    elem: ${(v.nodes[0]?.html || '').slice(0, 140)}\n`
          + `    súgó: ${v.helpUrl}`),
        `AKADÁLYMENTESÍTÉSI SÉRTÉS a(z) ${oldal.minta} oldalon.\n\n`
        + 'A `critical` és a `serious` szintre kapuzunk: ezek azok, amik egy\n'
        + 'képernyőolvasót vagy billentyűzetes navigációt HASZNÁLÓ embert\n'
        + 'ténylegesen megakasztanak (címke nélküli űrlapmező, gomb szöveg\n'
        + 'nélkül, elérhetetlen fókusz). A moderate/minor nem buktat.',
      ).toEqual([]);
    });
  }
});

test.describe('akadálymentesítési összegzés', () => {
  test('a teljes felület összesítése (mindig kiírja, mit talált)', async () => {
    const osszes = naploOlvas();
    const szintenkent: Record<string, number> = {};
    for (const s of osszes) {
      szintenkent[s.szint] = (szintenkent[s.szint] || 0) + s.darab;
    }

    // A riport akkor is látszik, ha minden zöld — ez a tesztelő kérdésére
    // adott VÁLASZ, nem csak egy kapu.
    const sorok = Object.entries(szintenkent)
      .sort((a, b) => b[1] - a[1])
      .map(([szint, db]) => `  ${szint}: ${db} elem`);
    // eslint-disable-next-line no-console
    console.log(
      `\n── AXE ÖSSZEGZÉS (${OLDALAK.length} oldal) ──\n`
      + (sorok.length ? sorok.join('\n') : '  nincs sértés')
      + `\n  kapuzott szintek: ${KAPUZOTT_SZINTEK.join(', ')}\n`,
    );

    const sulyosDb = osszes
      .filter((s) => KAPUZOTT_SZINTEK.includes(s.szint as never))
      .reduce((a, s) => a + s.darab, 0);

    expect(
      sulyosDb,
      `Összesen ${sulyosDb} critical/serious sértés a felületen. `
      + 'A tesztelő kérdése erre a számra vonatkozik.',
    ).toBe(0);
  });

  test('a szabály-kivételek listája nem duzzadhat fel indoklás nélkül', () => {
    for (const [szabaly, indok] of Object.entries(SZABALY_KIVETELEK)) {
      expect(
        indok.length,
        `A(z) "${szabaly}" szabály kivétel-indoklása túl rövid. Egy kikapcsolt\n`
        + 'akadálymentesítési szabály csak akkor elfogadható, ha le van írva,\n'
        + 'MIÉRT nem javítható a hiba maga. A „sok munka" nem indok.',
      ).toBeGreaterThan(30);
    }

    expect(
      Object.keys(SZABALY_KIVETELEK).length,
      'Háromnál több kikapcsolt szabálynál a mérés kezdi elveszíteni az '
      + 'értelmét — ilyenkor inkább a hibákat javítsuk.',
    ).toBeLessThanOrEqual(3);
  });
});
