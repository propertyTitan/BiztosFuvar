// =====================================================================
//  ÁTVÉTELI KÓD A FELADÓNAK — a két eset szétválasztása
//
//  A feladó MINDIG kap egy 6 jegyű kódot (`sender_delivery_code`), de annak
//  KÉT, egymástól nagyon eltérő jelentése van:
//
//    (1) MÁS veszi át  → ez VÉSZHELYZETI kód. Csak akkor adható a
//        szállítónak, ha a címzett nem elérhető, és a rendszer naplózza,
//        hogy ezzel zárult (photos.js → closed_by_code_type='sender_emergency').
//    (2) A FELADÓ veszi át → ez egyszerűen AZ ő átvételi kódja, semmi
//        vészhelyzet. A „Nem én veszem át" checkbox óta ez az ALAPESET.
//
//  Korábban a (2) esetben is a riasztó „🆘 Vészhelyzeti kód (csak ha a
//  címzett nem elérhető!)" kártya jelent meg — azzal a szöveggel, hogy „a
//  címzett SMS-ben megkapta", holott nincs is címzett.
//
//  ⚠️ A CÍMZETT kódját (`delivery_code`) a feladó SOHA nem láthatja: ha
//  ismerné, továbbadhatná a szállítónak, aki a címzett nélkül zárhatná le
//  a fuvart. Ezt a határt a backend scrubja adja, ez a spec őrzi a UI-n.
// =====================================================================
import { test, expect } from '@playwright/test';
import { createUser, createJob, loginAs, getDeliveryCode } from './helpers';

test('MÁS veszi át → vészhelyzeti kódként jelenik meg, a címzett kódja nélkül', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const job = await createJob(shipper, {
    recipient_name: 'Címzett Cecília',
    recipient_phone: '+36301112233',
  });

  await loginAs(page, shipper);
  await page.goto(`/dashboard/fuvar/${job.id}`);

  await expect(page.getByText(/Vészhelyzeti kód/i).first()).toBeVisible();
  await expect(page.getByText(/CSAK.*akkor add meg a szállítónak/i).first()).toBeVisible();
  // A címzettre hivatkozó szöveg itt HELYES — van címzett
  await expect(page.getByText(/A címzett a saját átvételi kódját/i).first()).toBeVisible();

  // A CÍMZETT kódja sehol nem jelenhet meg a feladónak
  const cimzettKod = await getDeliveryCode(job.id);
  const oldalSzoveg = await page.locator('body').innerText();
  expect(
    oldalSzoveg.includes(cimzettKod),
    'A feladó látja a CÍMZETT átvételi kódját — ezzel a szállító a címzett nélkül zárhatná le a fuvart!',
  ).toBe(false);
});

test('a FELADÓ veszi át → normál átvételi kód, nincs vészhelyzet-szöveg', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  // Nincs címzett → a feladó maga veszi át
  const job = await createJob(shipper, {
    recipient_name: undefined,
    recipient_phone: undefined,
  });

  await loginAs(page, shipper);
  await page.goto(`/dashboard/fuvar/${job.id}`);

  await expect(page.getByText(/Átvételi kódod/i)).toBeVisible();
  await expect(page.getByText(/Te veszed át a csomagot/i)).toBeVisible();
  // QR kód SEHOL — user-döntés (2026-08-06): csak a PIN marad
  await expect(page.getByAltText(/QR/i)).toHaveCount(0);

  // Nincs címzett — a riasztó vészhelyzet-szöveg félrevezető lenne
  await expect(page.getByText(/Vészhelyzeti kód/i)).toHaveCount(0);
  await expect(page.getByText(/A címzett a saját átvételi kódját/i)).toHaveCount(0);
});
