// =====================================================================
//  FEJLÉC-AVATAR — a TELJES lánc, a tárolásig (2026-08-16)
//
//  ⚠️ MIÉRT KELL EZ A SPEC — A PR #182 TANULSÁGA:
//
//  Az avatar-javítás első köre a backendet (login-válasz), a típust és a
//  fejléc renderelését javította, és a commit „teljes láncot" állított. A
//  tesztelő mégis azt jelentette: a kép továbbra sem látszik. Az ok: a
//  bejelentkező oldal a válaszból KÉZZEL MAZSOLÁZTA KI a mezőket a
//  localStorage-ba — és az avatar_url-t eldobta a küszöbön. A backend hiába
//  küldte, a fejléc hiába renderelte volna: a kettő KÖZÖTT, a tárolásnál
//  elveszett.
//
//  A meglévő tesztek ezt azért nem fogták, mert a `loginAs` helper a
//  localStorage-ot KÖZVETLENÜL írja — vagyis pont azt a lépést ugorja át,
//  amelyik hibás volt. Ez a spec ezért a VALÓDI bejelentkező űrlapon megy át.
//
//  A második teszt a visszatöltést méri: aki a javítás ELŐTT lépett be, annak
//  a tárolt objektumában nincs avatar_url — a fejlécnek ilyenkor egyszeri
//  /auth/me hívással kell pótolnia, újra-bejelentkezés nélkül. (A `loginAs`
//  avatar nélkül seedel, tehát itt kivételesen ELŐNY, hogy a tárolót írja:
//  pontosan a „régi session" állapotát állítja elő.)
//
//  ⚠️ Az avatar data:-URI, nem fájl-útvonal: a fejléc onError-e a nem betöltő
//  képet elrejti (szándékosan — törött-kép ikon ne legyen), tehát egy kamu
//  útvonallal a teszt az ELREJTETT képet keresné. A data:-URI mindig betölt.
// =====================================================================
import { test, expect } from '@playwright/test';
import { createUser, dbQuery } from './helpers';

// 1×1 pixeles, érvényes PNG.
const AVATAR_DATA_URI = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB'
  + 'h6FO1AAAAABJRU5ErkJggg==';

const AVATAR_A_FEJLECBEN = 'header img[src^="data:image/png"]';

test.describe('fejléc-avatar: a kép tényleg megjelenik', () => {
  test('a VALÓDI bejelentkező űrlapon át is megérkezik (a tárolási lánc ép)', async ({ page }) => {
    const user = await createUser('shipper', 'Avatar Teszt');
    await dbQuery('UPDATE users SET avatar_url = $1 WHERE id = $2', [AVATAR_DATA_URI, user.id]);

    // ⚠️ A /auth/me ELZÁRVA ebben a tesztben. Visszaméréskor kiderült: a
    // fejléc visszatöltő mechanizmusa (ami a hiányzó avatar_url-t a
    // /auth/me-ből pótolja) ELFEDTE a login-oldali tárolási hibát — a teszt
    // zölden maradt a visszavont javítással is, mert a kép „valahonnan" úgyis
    // megjött. Így viszont nem azt mérte, amit állított. Elzárt /auth/me
    // mellett a kép KIZÁRÓLAG a bejelentkezéskor eltárolt objektumból jöhet —
    // ez a valódi tárolási lánc-mérés. (Az EmailVerifyGate hibánál nem
    // blokkol, tehát az oldal ettől még használható.)
    await page.route('**/auth/me', (route) => route.abort());

    // NEM loginAs: az a localStorage-ot közvetlenül írja, és pont a hibás
    // lépést (mit tárol el a login-oldal a válaszból) ugorná át.
    await page.goto('/bejelentkezes');
    await page.locator('#auth-email').fill(user.email);
    await page.locator('#auth-password').fill('Jelszo123!');
    // ⚠️ NEM getByRole('button', {name:/Belépés/}).first(): az a FÜLVÁLTÓ
    // „Belépés" gombot találná el (type="button"), aminek a kattintása
    // semmit nem csinál — az első futás pont ezen bukott el, 15 mp timeouttal.
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.includes('bejelentkezes'), { timeout: 15_000 });

    await expect(
      page.locator(AVATAR_A_FEJLECBEN),
      'A profilkép nem jelent meg a fejlécben a bejelentkezés után.\n\n'
      + 'A backend a login-válaszban küldi az avatar_url-t — ha itt mégsem\n'
      + 'látszik, a bejelentkező oldal NEM TÁROLJA EL (a kézzel írt mező-lista\n'
      + 'a setCurrentUser-hívásban eldobja). Pontosan ez volt a PR #182 utáni\n'
      + 'hiba: a válasz „tartalmazza" még nem jelenti, hogy a kliens\n'
      + '„eltárolja" — a láncot a tárolásig kell mérni.',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('RÉGI session (avatar_url nélküli tárolt user) visszatöltődik újra-belépés nélkül', async ({ page }) => {
    const user = await createUser('shipper', 'Avatar Backfill');
    await dbQuery('UPDATE users SET avatar_url = $1 WHERE id = $2', [AVATAR_DATA_URI, user.id]);

    // KÉZI seed, avatar_url MEZŐ NÉLKÜL — pontosan úgy, ahogy egy javítás
    // előtti session kinéz. (A loginAs már avatar_url: null-t seedel, hogy a
    // visszatöltés ne fusson feleslegesen minden más specben — ezért a legacy
    // állapotot itt magunk állítjuk elő.)
    await page.addInitScript(
      ({ u, token }) => {
        window.localStorage.setItem('gofuvar_user', JSON.stringify(u));
        window.localStorage.setItem('gofuvar_token', token);
        window.localStorage.setItem('gofuvar_cookie_consent', JSON.stringify({ necessary: true }));
      },
      {
        u: {
          id: user.id, email: user.email, role: user.role, full_name: user.full_name,
        },
        token: user.token,
      },
    );
    await page.goto('/');

    await expect(
      page.locator(AVATAR_A_FEJLECBEN),
      'A régi (avatar_url mező nélküli) session nem töltötte vissza a képet.\n\n'
      + 'A fejlécnek egyszeri /auth/me hívással pótolnia kell a hiányzó mezőt —\n'
      + 'enélkül minden, a javítás előtt bejelentkezett felhasználó (köztük a\n'
      + 'tesztelő) a következő újra-bejelentkezésig monogramot látna, és azt\n'
      + 'hinné, a funkció továbbra sem működik.',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('avatar NÉLKÜLI usernek monogram jár, kérés-halmozás nélkül', async ({ page }) => {
    const user = await createUser('shipper', 'Monogram Manó');

    let meHivasok = 0;
    await page.route('**/auth/me', (route) => {
      meHivasok += 1;
      route.continue();
    });

    // Legacy seed itt is (avatar_url mező nélkül): a hurok-veszély pont a
    // visszatöltő ágban van, tehát azt kell felébreszteni.
    await page.addInitScript(
      ({ u, token }) => {
        window.localStorage.setItem('gofuvar_user', JSON.stringify(u));
        window.localStorage.setItem('gofuvar_token', token);
        window.localStorage.setItem('gofuvar_cookie_consent', JSON.stringify({ necessary: true }));
      },
      {
        u: {
          id: user.id, email: user.email, role: user.role, full_name: user.full_name,
        },
        token: user.token,
      },
    );
    await page.goto('/');
    await expect(page.locator('header').getByText('M', { exact: true }).first()).toBeVisible();

    // ⚠️ NEM abszolút plafont mérünk — az EmailVerifyGate (és más komponens)
    // is jogosan hívja a /auth/me-t, tehát a „legfeljebb 2" törékeny (az első
    // futás 3-at számolt, és hamisan bukott). A hurok ismérve a NÖVEKEDÉS:
    // beállás után nem jöhet több kérés.
    await page.waitForTimeout(1500);
    const beallasUtan = meHivasok;
    await page.waitForTimeout(2000);
    expect(
      meHivasok - beallasUtan,
      'A fejléc avatar-visszatöltése kérés-hurokba került: a beállás után is '
      + 'újabb /auth/me hívások mennek. A visszatöltésnek egyszerinek kell '
      + 'lennie — a merge után a mező definiált (null), az őrfeltétel lezár.',
    ).toBe(0);
  });
});
