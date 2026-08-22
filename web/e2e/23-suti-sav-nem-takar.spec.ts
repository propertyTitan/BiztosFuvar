// =====================================================================
//  A SÜTI-SÁV NEM TAKARHAT EL KATTINTHATÓ ELEMET (2026-08-22)
//
//  Manus-teszt, két külön bejelentett tünet, EGY gyökérok:
//   · GF-FT-07: „a lemondási modal első kattintásra nem nyílt meg"
//   · „a sütikezelő overlaye elnyelte az ajánlatelfogadó kattintást"
//
//  A süti-sáv fixen az alsó szélen ül, és a lap ALJÁRA eső gombokat
//  (Fuvar lemondása, ajánlat-elfogadás) fizikailag eltakarta: friss
//  sessionben az első kattintás a sávot találta el, és némán elveszett.
//  A javítás: amíg a sáv látszik, a body annyi alsó margót kap, hogy
//  minden tartalom a sáv fölé görgethető.
//
//  A teszt a PONTOS Manus-forgatókönyv: friss session (nincs süti-döntés),
//  a lap alján lévő „Fuvar lemondása" gomb, EGYETLEN kattintás — a
//  dialógusnak meg kell nyílnia. A javítás nélkül a Playwright kattintása
//  a sávba ütközik (az elem takarásban van), és timeout-tal bukik.
// =====================================================================
import { test, expect } from '@playwright/test';
import { createUser, createJob } from './helpers';

test('friss sessionben a lap-alji gomb ELSŐ kattintásra működik (a süti-sáv nem takar)', async ({ page }) => {
  const felado = await createUser('shipper', 'Süti Sára');
  const job = await createJob(felado);

  // ⚠️ NEM loginAs: az beállítja a süti-döntést is — itt pont a FRISS
  // session kell, amelyben a sáv még látszik.
  await page.addInitScript(
    ({ u, token }) => {
      window.localStorage.setItem('gofuvar_user', JSON.stringify(u));
      window.localStorage.setItem('gofuvar_token', token);
    },
    {
      u: {
        id: felado.id, email: felado.email, role: felado.role,
        full_name: felado.full_name, avatar_url: null,
      },
      token: felado.token,
    },
  );

  await page.goto(`/dashboard/fuvar/${job.id}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  // A sáv tényleg látszik (a teszt ne legyen vakon zöld, ha a banner eltűnt)
  await expect(page.getByRole('dialog', { name: /Süti nyilatkozat/ })).toBeVisible();

  // ⚠️ A DETERMINISZTIKUS MÉRÉS — visszaméréskor derült ki, hogy a puszta
  // kattintás-út VAKON ZÖLD: a gomb alatt még lábléc is van, így a
  // Playwright görgetése kiemeli a sáv alól, és a kattintás enélkül is
  // átmegy. Amit a javítás GARANTÁL, az a geometria: amíg a sáv látszik, a
  // body alsó margója legalább a sáv magassága — így SEMMILYEN elem nem
  // ragadhat kigörgethetetlenül a sáv alá. Ezt mérjük közvetlenül.
  const meres = await page.evaluate(() => {
    const sav = document.querySelector('[aria-label="Süti nyilatkozat"]') as HTMLElement;
    return {
      savMagassag: sav?.offsetHeight ?? 0,
      bodyMargo: parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
    };
  });
  expect(meres.savMagassag, 'a sáv nem renderelt — a mérés vak lenne').toBeGreaterThan(30);
  expect(
    meres.bodyMargo,
    `A body alsó margója (${meres.bodyMargo}px) kisebb, mint a süti-sáv magassága (${meres.savMagassag}px) — a lap aljára eső gombok (Fuvar lemondása, ajánlat-elfogadás) a sáv ALÁ ragadhatnak, és az első kattintás némán elveszik. Ez volt a Manus GF-FT-07 tünete.`,
  ).toBeGreaterThanOrEqual(meres.savMagassag);

  // A süti-döntés után a margó eltűnik (nem hagyunk szemetet a layoutban).
  await page.getByRole('button', { name: 'Rendben, értem' }).click();
  await page.waitForTimeout(300);
  const utana = await page.evaluate(
    () => parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
  );
  expect(utana, 'a süti-döntés után a body-margó bent ragadt').toBe(0);

  // A viselkedési út is (kiegészítésként): a gomb kattintható, a dialógus nyílik.
  const gomb = page.getByRole('button', { name: 'Fuvar lemondása' });
  await gomb.scrollIntoViewIfNeeded();
  await gomb.click({ timeout: 5_000 });

  await expect(
    page.getByRole('dialog', { name: /lemondása|Lemondod/i }).first(),
    'A lemondás-dialógus nem nyílt meg az ELSŐ kattintásra.',
  ).toBeVisible({ timeout: 5_000 });
});
