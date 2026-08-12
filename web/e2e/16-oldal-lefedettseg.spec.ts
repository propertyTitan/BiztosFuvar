// =====================================================================
//  OLDAL-LEFEDETTSÉG — a felület MINDEN oldala megnyílik és renderel
//
//  Az API-oldalon már mértünk és lezártuk a rést (backend
//  szerep-lefedettseg.test.js: minden végpontra fut sikeres hívás). A
//  BÖNGÉSZŐS oldalon viszont sokáig csak a fő flow-k voltak végigkattintva:
//  a 47 oldalból az E2E ~11-et látott. Ha egy oldal fehéren elszáll — rossz
//  import, null-ra hivatkozás, elrontott hook —, azt semmilyen API-teszt nem
//  veszi észre, mert a backend rendben válaszol.
//
//  Ez a spec MINDEN oldalt megnyit a hozzá tartozó szereplővel, és azt
//  ellenőrzi, ami minden oldalra igaz kell legyen:
//    1. a dokumentum betöltődik (nem 4xx/5xx)
//    2. nincs kezeletlen JS-kivétel és nincs konzol-hiba
//    3. tényleg renderelt tartalom (nem üres, nem a 404-oldal)
//    4. nem látszik nyers hibaállapot („Szerverhiba", „Something went wrong")
//
//  ⚠️ ÖNVÉDŐ: az utolsó teszt elhasal, ha új oldal kerül az app/ alá, ami
//  nincs felvéve a leltárba — és nincs rá írásos indok. Így a böngészős
//  lefedettség nem tud némán visszacsúszni, ahogy az API-nál sem.
// =====================================================================
import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs } from './helpers';
import {
  OLDALAK, KIVETELEK, keszitsFixtures, Oldal, Fixtures,
} from './oldal-leltar';

// ── Ami zajnak számít, nem hibának ────────────────────────────────────
const ELNEZETT_KONZOL = [
  /favicon/i,
  /Download the React DevTools/i,
  /ERR_INTERNET_DISCONNECTED/i,
  /Google Maps JavaScript API/i,
  /net::ERR_ABORTED/i,
  // A térkép-komponens kulcs nélkül/kvótával panaszkodhat — nem a mi hibánk
  /googleapis\.com/i,
  // A böngésző konzol-HIBAKÉNT naplózza a 4xx válaszokat is — pedig azok
  // NORMÁLIS alkalmazás-működés: érvénytelen email-token → 400, nem a saját
  // fuvaram részlete → 403. Az app ezeket lekezeli és hibaállapotot mutat.
  // Az 5xx-et SZÁNDÉKOSAN NEM nézzük el: az valódi szerver-összeomlás.
  /Failed to load resource.*status of 4\d\d/i,
];

/** Nyers hibaállapotok, amiknek sosem szabad a felületen megjelenniük. */
const HIBA_JELEK = [
  /Szerverhiba/i,
  /Something went wrong/i,
  /Application error/i,
  /Unhandled Runtime Error/i,
  /TypeError:/,
  /Cannot read propert/i,
];

// ── A LELTÁR a közös modulból jön ────────────────────────────────────
// Korábban itt élt, de az akadálymentesítési (19) és a halott-link (20)
// mérés is ugyanezt az 51 oldalt járja be. Három külön lista szétcsúszott
// volna, és a lenti önvédő őr csak ezt az egyet védte volna.

let F: Fixtures;

test.beforeAll(async () => { F = await keszitsFixtures(); });

/** Az oldal megnyitása a megfelelő szereplővel + a közös ellenőrzések. */
async function ellenorizOldalt(page: Page, oldal: Oldal) {
  const zaj: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const szoveg = msg.text();
    if (ELNEZETT_KONZOL.some((r) => r.test(szoveg))) return;
    zaj.push(`[konzol] ${szoveg.slice(0, 200)}`);
  });
  page.on('pageerror', (err) => {
    zaj.push(`[kezeletlen kivétel] ${String(err).slice(0, 200)}`);
  });

  const user = oldal.szereplo === 'anon' ? null
    : oldal.szereplo === 'felado' ? F.felado
    : oldal.szereplo === 'szallito' ? F.szallito
    : F.admin;
  if (user) await loginAs(page, user);

  const cel = oldal.url(F);
  const valasz = await page.goto(cel, { waitUntil: 'domcontentloaded' });

  // 1. A dokumentum betöltődött
  expect(valasz?.status(), `${cel} → HTTP ${valasz?.status()}`).toBeLessThan(400);

  // A kliens-oldali adatlekérés és a hidratálás befejeződjön
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(600);

  // Interakcióval feltáruló állapot (pl. profil szerkesztő-űrlap): azt is
  // renderelnie kell hiba nélkül — a konzol-figyelő fut tovább, tehát az
  // állapotváltás közben dobott kivétel is ide esik.
  if (oldal.allapot) {
    await oldal.allapot(page);
    await page.waitForTimeout(300);
  }

  const torzs = await page.locator('body').innerText();

  // 2. Nincs kezeletlen kivétel / konzol-hiba
  expect(zaj, `${cel} — JS-hiba az oldalon:\n${zaj.join('\n')}`).toEqual([]);

  // 3. Renderelt tartalom (a fejléc+lábléc önmagában kevés lenne)
  expect(
    torzs.replace(/\s+/g, ' ').trim().length,
    `${cel} — az oldal gyakorlatilag üresen jött vissza`,
  ).toBeGreaterThan(120);

  // 4. Nincs nyers hibaállapot a képernyőn
  for (const jel of HIBA_JELEK) {
    expect(
      jel.test(torzs),
      `${cel} — nyers hibaállapot látszik a felületen (${jel}):\n` +
      torzs.slice(0, 300),
    ).toBe(false);
  }

  // 5. Nem a 404-oldalon kötöttünk ki (kivéve ha ezt vártuk)
  //
  // ⚠️ A puszta „404" sztringre NEM szabad illeszteni: az oldalakon vannak
  // véletlen 6 jegyű számok (átvételi PIN), és egy „548404" kódra a teszt
  // lebegett — ez élesben is előjött. Az app/not-found.tsx valódi
  // címsoraira szűrünk helyette, ami egyértelmű.
  if (!oldal.varhatoAtiranyitas) {
    const negyszaznegyes = /Az oldal nem található|Másik mód szükséges/.test(torzs);
    expect(negyszaznegyes, `${cel} — a 404-oldalra futott`).toBe(false);
  }
}

// ── A tesztek ─────────────────────────────────────────────────────────
test.describe('oldal-lefedettség: minden oldal megnyílik és renderel', () => {
  for (const oldal of OLDALAK) {
    test(`${oldal.minta}${oldal.allapot ? ' [állapot]' : ''} (${oldal.szereplo})`, async ({ page }) => {
      await ellenorizOldalt(page, oldal);
    });
  }
});

// ── Az őr ─────────────────────────────────────────────────────────────
test.describe('oldal-leltár őr', () => {
  test('minden app/ alatti oldal szerepel a leltárban', async () => {
    const appDir = path.join(process.cwd(), 'app');
    const talalt: string[] = [];
    const bejar = (dir: string) => {
      for (const bejegyzes of fs.readdirSync(dir, { withFileTypes: true })) {
        const teljes = path.join(dir, bejegyzes.name);
        if (bejegyzes.isDirectory()) bejar(teljes);
        else if (bejegyzes.name === 'page.tsx') {
          const utvonal = '/' + path.relative(appDir, dir).split(path.sep).join('/');
          talalt.push(utvonal === '/.' ? '/' : utvonal);
        }
      }
    };
    bejar(appDir);

    const leltarban = new Set(OLDALAK.map((o) => o.minta));
    const hianyzik = talalt.filter((u) => !leltarban.has(u) && !KIVETELEK[u]);
    expect(
      hianyzik,
      'ÚJ OLDAL A LELTÁRON KÍVÜL — nincs rá böngészős ellenőrzés.\n' +
      'Vedd fel az OLDALAK listába a szereplővel együtt, vagy a KIVETELEK közé INDOKKAL:\n' +
      hianyzik.map((u) => `  { minta: '${u}', url: () => '${u}', szereplo: 'anon' },`).join('\n'),
    ).toEqual([]);

    // A leltár se hivatkozzon már nem létező oldalra
    const talaltSet = new Set(talalt);
    const elavult = OLDALAK.map((o) => o.minta).filter((u) => !talaltSet.has(u));
    expect(elavult, `A leltárban nem létező oldal szerepel: ${elavult.join(', ')}`).toEqual([]);
  });
});
