// Stale-state osztály-teszt — a tesztelői BUG-015/030 tanulsága: a login/
// logout kliens-oldali navigáció, a globálisan mountolt komponensek nem
// frissültek. Ez a spec a TELJES osztályt őrzi, kézi frissítés nélkül:
//   1) user-váltásnál a verifikációs banner SOHA nem mutathatja az előző
//      user email-címét (BUG-015 — adatvédelmi hiba volt)
//   2) az "Összes elolvasva" a fejléc harang-badge-ét is nullázza F5 nélkül
import { test, expect } from '@playwright/test';
import { createUser, dbQuery, loginAs } from './helpers';

test('user-váltás automatikus sessionhatárral: a kapu a MOSTANI user emailjét mutatja (BUG-015)', async ({ page }) => {
  // Ehhez a teszthez a userek email_verified=false kell, hogy az
  // EmailVerifyGate (megerősítő kapu) éljen és a user emailjét mutassa.
  const userA = await createUser('shipper', 'Stale Anna');
  const userB = await createUser('shipper', 'Stale Bella');
  await dbQuery('UPDATE users SET email_verified = false WHERE id IN ($1, $2)', [userA.id, userB.id]);

  // Egyszeri seed: a loginAs addInitScript-je az automatikus dokumentumváltás
  // után is visszaírná A-t, felülírva a valódi fiókváltás eredményét.
  await page.goto('/');
  await page.evaluate(({ u, token }) => {
    window.localStorage.setItem('gofuvar_user', JSON.stringify(u));
    window.localStorage.setItem('gofuvar_token', token);
    window.localStorage.setItem('gofuvar_cookie_consent', JSON.stringify({ necessary: true }));
  }, {
    u: { id: userA.id, email: userA.email, role: userA.role, full_name: userA.full_name, avatar_url: null },
    token: userA.token,
  });
  await page.goto('/');
  await expect(page.getByText(userA.email).first()).toBeVisible({ timeout: 20_000 });

  // A fiókváltás maga csak storage + auth esemény. Az alkalmazásnak kell
  // automatikusan új dokumentumot betöltenie, hogy A kliensállapota eltűnjön.
  await Promise.all([
    page.waitForEvent('domcontentloaded', { timeout: 20_000 }),
    page.evaluate(
    ({ u, token }) => {
      window.localStorage.setItem('gofuvar_user', JSON.stringify(u));
      window.localStorage.setItem('gofuvar_token', token);
      window.dispatchEvent(new Event('gofuvar:auth'));
    },
    {
      u: { id: userB.id, email: userB.email, role: userB.role, full_name: userB.full_name, avatar_url: null },
      token: userB.token,
    },
    ),
  ]);

  // Az új dokumentum a B-sessionnel álljon fel — kézi goto/reload nélkül.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(userB.email).first()).toBeVisible({ timeout: 20_000 });
  expect(await page.getByText(userA.email).count()).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('gofuvar_user') || '{}').id)).toBe(userB.id);
});

test('harang-badge: "Összes elolvasva" után F5 nélkül nullázódik (BUG-030)', async ({ page }) => {
  const user = await createUser('shipper', 'Harang Hanna');
  await dbQuery(
    `INSERT INTO notifications (user_id, type, title, body, link)
     VALUES ($1, 'job_paid', 'Teszt értesítés 1', 'stale-state teszt', '/'),
            ($1, 'job_paid', 'Teszt értesítés 2', 'stale-state teszt', '/')`,
    [user.id],
  );

  await loginAs(page, user);
  await page.goto('/');
  // A fejléc badge mutatja a 2 olvasatlant
  await expect(page.locator('header').getByText('2', { exact: true })).toBeVisible({ timeout: 20_000 });

  // KLIENS-OLDALI navigáció az értesítésekhez (a fejléc nem mountol újra —
  // pont ezt a stale-esetet teszteljük, goto/reload nélkül)
  await page.locator('header a[href="/ertesitesek"]').click();
  await expect(page.getByText('Teszt értesítés 1').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /Összes olvasva/i }).click();

  // A fejléc badge F5 nélkül tűnjön el
  await expect(page.locator('header').getByText('2', { exact: true })).toHaveCount(0, { timeout: 20_000 });
});
