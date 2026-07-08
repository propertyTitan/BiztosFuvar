// Stale-state osztály-teszt — a tesztelői BUG-015/030 tanulsága: a login/
// logout kliens-oldali navigáció, a globálisan mountolt komponensek nem
// frissültek. Ez a spec a TELJES osztályt őrzi, reload nélkül:
//   1) user-váltásnál a verifikációs banner SOHA nem mutathatja az előző
//      user email-címét (BUG-015 — adatvédelmi hiba volt)
//   2) az "Összes elolvasva" a fejléc harang-badge-ét is nullázza F5 nélkül
import { test, expect } from '@playwright/test';
import { createUser, dbQuery, loginAs } from './helpers';

test('user-váltás reload nélkül: a kapu a MOSTANI user emailjét mutatja (BUG-015)', async ({ page }) => {
  // Ehhez a teszthez a userek email_verified=false kell, hogy az
  // EmailVerifyGate (megerősítő kapu) éljen és a user emailjét mutassa.
  const userA = await createUser('shipper', 'Stale Anna');
  const userB = await createUser('shipper', 'Stale Bella');
  await dbQuery('UPDATE users SET email_verified = false WHERE id IN ($1, $2)', [userA.id, userB.id]);

  await loginAs(page, userA);
  await page.goto('/');
  await expect(page.getByText(userA.email).first()).toBeVisible({ timeout: 20_000 });

  // In-page user-váltás — pontosan azt csinálja, amit a login-oldal
  // setCurrentUser-je (localStorage + gofuvar:auth esemény), reload nélkül
  await page.evaluate(
    ({ u, token }) => {
      window.localStorage.setItem('gofuvar_user', JSON.stringify(u));
      window.localStorage.setItem('gofuvar_token', token);
      window.dispatchEvent(new Event('gofuvar:auth'));
    },
    {
      u: { id: userB.id, email: userB.email, role: userB.role, full_name: userB.full_name },
      token: userB.token,
    },
  );

  // Az ELŐZŐ user emailje tűnjön el, az újé jelenjen meg — F5 nélkül
  await expect(page.getByText(userA.email)).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(userB.email).first()).toBeVisible({ timeout: 20_000 });
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
