// A fix áras foglalás TELJES lezárási útja a UI-n át — a BUG-041 osztály
// őre. A tesztelő legnagyobb fogása az volt, hogy a foglalás a fizetés
// után UI nélkül maradt; ez a spec pontosan azt a felületet hajtja végig,
// ami akkor hiányzott: sofőr felvétel-igazolás → kód-lezárás → a feladó
// "Kézbesítve" + értékelés.
//
// A setup (útvonal, foglalás, megerősítés, díj-fizetés) API-n megy — a
// fizetési UI-t a 02-es spec fedi; itt a foglalás-VÉGREHAJTÁS a tárgy.
import { test, expect } from '@playwright/test';
import { API_URL, createUser, dbQuery, loginAs, TINY_PNG } from './helpers';

async function apiPost(token: string, path: string, body: unknown) {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} hiba: ${res.status} ${await res.text()}`);
  return res.json();
}

test('foglalás végrehajtása: sofőr pickup + kód-lezárás → feladó Kézbesítve + értékelés', async ({ browser }) => {
  const shipper = await createUser('shipper', 'Foglaló Flóra');
  const carrier = await createUser('carrier', 'Útvonal Ubul');

  // --- Setup API-n: útvonal → foglalás → megerősítés → díj-fizetés ---
  const route = await apiPost(carrier.token, '/carrier-routes', {
    title: 'E2E foglalás-flow útvonal',
    departure_at: new Date(Date.now() + 86400000).toISOString(),
    waypoints: [
      { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
      { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
    ],
    prices: [{ size: 'M', price_huf: 14000 }],
    status: 'open',
  });
  const booking = await apiPost(shipper.token, `/carrier-routes/${route.id}/bookings`, {
    length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
    pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.5104, pickup_lng: 19.0621,
    dropoff_address: 'Szeged, Kossuth Lajos sugárút 1.', dropoff_lat: 46.2546, dropoff_lng: 20.1443,
  });
  await apiPost(carrier.token, `/route-bookings/${booking.id}/confirm`, {});
  await apiPost(shipper.token, `/route-bookings/${booking.id}/pay`, { consent: true });
  await apiPost(shipper.token, `/route-bookings/${booking.id}/confirm-payment`, {});

  const { rows } = await dbQuery('SELECT delivery_code FROM route_bookings WHERE id = $1', [booking.id]);
  const code = rows[0].delivery_code as string;
  const idPrefix = `b-${booking.id.slice(0, 8)}-`;

  const carrierCtx = await browser.newContext();
  const carrierPage = await carrierCtx.newPage();
  await loginAs(carrierPage, carrier);

  // --- 1. Sofőr: felvétel igazolása a foglaláson (a BUG-041 előtt ez a
  //        panel nem is létezett) ---
  await carrierPage.goto(`/sofor/utvonal/${route.id}`);
  await expect(carrierPage.getByText('Fuvar indítása').first()).toBeVisible({ timeout: 20_000 });
  await carrierPage.locator(`#${idPrefix}pickup-photo`).setInputFiles({
    name: 'felvetel.png', mimeType: 'image/png', buffer: TINY_PNG,
  });
  await carrierPage.getByRole('button', { name: /Felvétel igazolása/ }).click();
  await expect(carrierPage.getByText('Kézbesítés igazolása').first()).toBeVisible({ timeout: 20_000 });

  // --- 2. Sofőr: kézbesítés a címzetti kóddal ---
  await carrierPage.locator(`#${idPrefix}dropoff-photo`).setInputFiles({
    name: 'atadas.png', mimeType: 'image/png', buffer: TINY_PNG,
  });
  await carrierPage.getByPlaceholder('••••••').fill(code);
  await carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ }).click();
  await expect(carrierPage.getByText(/Kézbesítve/).first()).toBeVisible({ timeout: 20_000 });

  // --- 3. Feladó: Kézbesítve blokk + értékelés lehetőség ---
  const shipperCtx = await browser.newContext();
  const shipperPage = await shipperCtx.newPage();
  await loginAs(shipperPage, shipper);
  await shipperPage.goto('/fuvarjaim?tab=foglalasaim');
  await expect(shipperPage.getByText(/Kézbesítve/).first()).toBeVisible({ timeout: 20_000 });
  await expect(shipperPage.getByText(/készpénzben jár a sofőrnek/).first()).toBeVisible();

  // --- 4. DB-végállapot ---
  const { rows: final } = await dbQuery(
    'SELECT status, delivered_at FROM route_bookings WHERE id = $1', [booking.id],
  );
  expect(final[0].status).toBe('delivered');
  expect(final[0].delivered_at).toBeTruthy();

  await carrierCtx.close();
  await shipperCtx.close();
});
