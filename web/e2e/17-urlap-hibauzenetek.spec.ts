// =====================================================================
//  ŰRLAP-HIBAÜZENETEK — amit a FELHASZNÁLÓ lát, ha elrontja
//
//  Ez volt az utolsó rés a lefedettségben. A rossz értékek kezelését eddig
//  két helyen őriztük:
//    - backend: 16-féle szemét minden mezőbe (hulyebiztos-matrix)
//    - web logika: 20 unit teszt a validációs függvényekre
//  De EGYIK SEM nézte, hogy a BÖNGÉSZŐBEN a felhasználó kap-e értelmes,
//  magyar magyarázatot. Egy tökéletes validációs függvény semmit nem ér, ha
//  a hibaüzenet nem jelenik meg, vagy nem ahhoz a mezőhöz tartozik.
//
//  Amit itt ellenőrzünk (a felület szemszögéből):
//    1. negatív érték BE SEM ÍRHATÓ (a szűrés a billentyűzetnél fog)
//    2. tört érték egész mezőben LÁTHATÓ hibaüzenetet kap — és NEM alakul
//       csendben mássá (a 12,5 cm-ből nem lesz 125 cm)
//    3. üres kötelező mező konkrét, megnevezett hibaüzenetet kap
//    4. a hibás űrlap NEM küldődik el (a szerver felé el sem indul kérés)
//    5. a hiba javítása után a hibaüzenet eltűnik és a feladás megy
// =====================================================================
import { test, expect } from '@playwright/test';
import { createUser, loginAs, selectAddress } from './helpers';

/** Az űrlap megnyitása bejelentkezett feladóval. */
/** Az űrlapon BELÜLI hibaüzenetek. A toast ugyanazt a szöveget mutatja
 *  (szándékosan: a user a képernyő tetején is lássa), de itt kifejezetten a
 *  MEZŐ MELLETTI magyarázatot ellenőrizzük — az segít javítani. */
function urlapHiba(page: import('@playwright/test').Page, minta: RegExp) {
  return page.locator('form').getByText(minta);
}

async function ujFuvarUrlap(page: import('@playwright/test').Page) {
  const felado = await createUser('shipper', 'Hibaüzenet Feladó');
  await loginAs(page, felado);
  await page.goto('/dashboard/uj-fuvar');
  await expect(page.getByPlaceholder(/Költöztetés Budapest/)).toBeVisible();
  return felado;
}

test.describe('új fuvar űrlap: mit lát a user, ha elrontja', () => {
  test('negatív értéket be sem lehet írni a szám-mezőkbe', async ({ page }) => {
    await ujFuvarUrlap(page);

    const hossz = page.getByPlaceholder('pl. 120');
    await hossz.fill('-50');
    expect(
      await hossz.inputValue(),
      'A mínuszjel bekerült a mezőbe — a beviteli szűrés nem fog.',
    ).toBe('50');

    const ar = page.getByPlaceholder(/65000/);
    await ar.fill('-15000');
    expect(await ar.inputValue()).toBe('15000');
  });

  test('tört érték egész mezőben: LÁTHATÓ hibaüzenet, és nem alakul át csendben', async ({ page }) => {
    await ujFuvarUrlap(page);

    const hossz = page.getByPlaceholder('pl. 120');
    await hossz.fill('12,5');

    // A magyar tizedesvessző pontra vált, de az ÉRTÉK megmarad — ha
    // eldobnánk a tizedest, 125 lenne belőle: egy nagyságrenddel elhibázott
    // méret, némán. Ezt a hibaosztályt szándékosan LÁTHATÓVÁ tesszük.
    expect(
      await hossz.inputValue(),
      'A tizedes némán eltűnt — így a 12,5 cm-ből 125 cm lett volna!',
    ).toBe('12.5');

    await page.getByRole('button', { name: /Fuvar feladása/ }).click();

    await expect(
      urlapHiba(page, /Hosszúság \(cm\): egész számot adj meg/i),
      'A user nem kapott magyarázatot a tört értékre',
    ).toBeVisible();
  });

  test('üres kötelező mezők: mindegyik MEGNEVEZVE kap hibaüzenetet', async ({ page }) => {
    await ujFuvarUrlap(page);

    // Semmit nem töltünk ki, csak megnyomjuk a feladást
    await page.getByRole('button', { name: /Fuvar feladása/ }).click();

    for (const uzenet of [
      /Kérjük, töltsd ki: Megnevezés/i,
      /Kérjük, töltsd ki: Hosszúság \(cm\)/i,
      /Kérjük, töltsd ki: Szélesség \(cm\)/i,
      /Kérjük, töltsd ki: Magasság \(cm\)/i,
      /Kérjük, töltsd ki: Súly \(kg\)/i,
      /Kérjük, töltsd ki: Fuvardíj \(Ft\)/i,
    ]) {
      await expect(urlapHiba(page, uzenet), `Hiányzó hibaüzenet: ${uzenet}`).toBeVisible();
    }
  });

  test('a hibás űrlap el sem indít kérést a szerver felé', async ({ page }) => {
    await ujFuvarUrlap(page);

    let kuldott = false;
    page.on('request', (r) => {
      if (r.url().includes('/jobs') && r.method() === 'POST') kuldott = true;
    });

    await page.getByRole('button', { name: /Fuvar feladása/ }).click();
    await page.waitForTimeout(1200);

    expect(
      kuldott,
      'A hibás űrlap elküldte a kérést — a szerverre bízta a validációt.',
    ).toBe(false);
  });

  test('„más veszi át": a címzett neve és telefonja kötelezővé válik', async ({ page }) => {
    await ujFuvarUrlap(page);

    // Alapból nincs címzett-mező
    await expect(page.getByPlaceholder('pl. Kiss Anna')).toHaveCount(0);

    await page.getByText('Nem én veszem át a csomagot').click();
    await expect(page.getByPlaceholder('pl. Kiss Anna')).toBeVisible();

    await page.getByRole('button', { name: /Fuvar feladása/ }).click();
    await expect(urlapHiba(page, /Kérjük, töltsd ki: Címzett neve/i)).toBeVisible();
    await expect(urlapHiba(page, /Kérjük, töltsd ki: Címzett telefonszáma/i)).toBeVisible();

    // Szemét telefonszám → saját, beszédes üzenet
    await page.getByPlaceholder('pl. Kiss Anna').fill('Kiss Anna');
    await page.getByPlaceholder('+36 30 123 4567').fill('hívj fel');
    await page.getByRole('button', { name: /Fuvar feladása/ }).click();
    await expect(urlapHiba(page, /csak számokat tartalmazhat/i)).toBeVisible();

    // Túl rövid szám → másik, konkrét üzenet
    await page.getByPlaceholder('+36 30 123 4567').fill('123');
    await page.getByRole('button', { name: /Fuvar feladása/ }).click();
    await expect(urlapHiba(page, /telefonszám túl rövid/i)).toBeVisible();
  });

  // MEGJEGYZÉS: a HÁZSZÁMIG PONTOS cím kikényszerítését SZÁNDÉKOSAN nem itt
  // teszteljük E2E-ben. A logika (precisionError: mi számít elég pontosnak)
  // kimerítően unit-tesztelt: web/src/components/AddressAutocomplete.test.ts.
  // A precíz cím elfogadása + valós feladás pedig a 01-regisztracio-feladas és
  // a 05-hozasd-el flow-ban megy végig, megbízhatóan.
  // Egy külön „gépeld be a várost, és nézd a választ" E2E itt élő Google
  // Places-autocomplete-től + a billentyűs kiválasztás időzítésétől függött,
  // ami a teljes suite-ban (sok korábbi Places-hívás után) flaky volt — a
  // néma CI-piros pedig rosszabb, mint a redundancia elhagyása. Ez a fájl így
  // KLIENS-OLDALI, determinisztikus űrlap-validációra fókuszál.

  test('a hibák javítása után a feladás végigmegy', async ({ page }) => {
    await ujFuvarUrlap(page);

    // Előbb elrontjuk
    await page.getByRole('button', { name: /Fuvar feladása/ }).click();
    await expect(urlapHiba(page, /Kérjük, töltsd ki: Megnevezés/i)).toBeVisible();

    // Majd rendesen kitöltjük
    await page.getByPlaceholder(/Költöztetés Budapest/).fill('Javítás utáni feladás');
    await page.waitForFunction(() => Boolean((window as any).google?.maps?.places), null, {
      timeout: 30_000,
    });
    const cimek = page.getByPlaceholder(/^pl\. (Budapest|Szeged)/);
    await selectAddress(page, cimek.first(), 'Budapest, Váci út 1');
    await selectAddress(page, cimek.nth(1), 'Szeged, Kossuth Lajos sugárút 1');
    await page.getByPlaceholder('pl. 120').fill('40');
    await page.getByPlaceholder('pl. 80').fill('30');
    await page.getByPlaceholder('pl. 100').fill('20');
    await page.getByPlaceholder('pl. 350').fill('5');
    await page.getByPlaceholder(/65000/).fill('15000');

    // A megnevezés hibaüzenete eltűnt
    await expect(urlapHiba(page, /Kérjük, töltsd ki: Megnevezés/i)).toHaveCount(0);

    const [valasz] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/jobs') && r.request().method() === 'POST'),
      page.getByRole('button', { name: /Fuvar feladása/ }).click(),
    ]);
    expect(valasz.status(), await valasz.text()).toBe(201);
    await page.waitForURL(/\/dashboard\/fuvar\//);
  });
});

test.describe('járat-hirdetés űrlap: múltbeli időpont', () => {
  test('múltbeli indulás: látható figyelmeztetés, és nem publikál', async ({ page }) => {
    const szallito = await createUser('carrier', 'Járat Szállító');
    await loginAs(page, szallito);
    await page.goto('/sofor/uj-utvonal');

    const idopont = page.locator('input[type="datetime-local"]');
    await expect(idopont).toBeVisible();

    // A naptár is korlátoz (min attribútum), de a kézzel beírt/beillesztett
    // értéket a JS-ág fogja meg — ezt teszteljük.
    await idopont.fill('2020-01-01T08:00');

    await expect(
      page.getByText(/Ez az időpont már elmúlt/i),
      'A user nem kapott figyelmeztetést a múltbeli indulásra',
    ).toBeVisible();

    let kuldott = false;
    page.on('request', (r) => {
      if (r.url().includes('/carrier-routes') && r.method() === 'POST') kuldott = true;
    });
    await page.getByRole('button', { name: 'Mentés piszkozatként' }).click();
    await page.waitForTimeout(1000);
    expect(kuldott, 'Múltbeli időponttal elindult a mentés!').toBe(false);
  });
});
