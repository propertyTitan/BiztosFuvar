// A fix áras foglalás TELJES lezárási útja a UI-n át — a BUG-041 osztály
// őre. A tesztelő legnagyobb fogása az volt, hogy a foglalás a fizetés
// után UI nélkül maradt; ez a spec pontosan azt a felületet hajtja végig,
// ami akkor hiányzott: szállító felvétel-igazolás → kód-lezárás → a feladó
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

async function createPaidBooking() {
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
  return { shipper, carrier, route, booking, code };
}

test('foglalás végrehajtása: szállító pickup + kód-lezárás → feladó Kézbesítve + értékelés', async ({ browser }) => {
  const { shipper, carrier, route, booking, code } = await createPaidBooking();
  const idPrefix = `b-${booking.id.slice(0, 8)}-`;

  const carrierCtx = await browser.newContext();
  const carrierPage = await carrierCtx.newPage();
  await loginAs(carrierPage, carrier);

  // --- 1. Szállító: felvétel igazolása a foglaláson (a BUG-041 előtt ez a
  //        panel nem is létezett) ---
  await carrierPage.goto(`/sofor/utvonal/${route.id}`);
  await expect(carrierPage.getByText('Fuvar indítása').first()).toBeVisible({ timeout: 20_000 });
  await carrierPage.locator(`#${idPrefix}pickup-photo`).setInputFiles({
    name: 'felvetel.png', mimeType: 'image/png', buffer: TINY_PNG,
  });
  await carrierPage.getByRole('button', { name: /Felvétel igazolása/ }).click();
  await expect(carrierPage.getByText('Kézbesítés igazolása').first()).toBeVisible({ timeout: 20_000 });

  // --- 2. Szállító: kézbesítés a címzetti kóddal ---
  await carrierPage.locator(`#${idPrefix}dropoff-photo`).setInputFiles({
    name: 'atadas.png', mimeType: 'image/png', buffer: TINY_PNG,
  });
  await carrierPage.getByPlaceholder('6 számjegy').fill(code);
  await carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ }).click();
  await expect(carrierPage.getByText(/Kézbesítve/).first()).toBeVisible({ timeout: 20_000 });

  // --- 3. Feladó: Kézbesítve blokk + értékelés lehetőség ---
  const shipperCtx = await browser.newContext();
  const shipperPage = await shipperCtx.newPage();
  await loginAs(shipperPage, shipper);
  await shipperPage.goto('/fuvarjaim?tab=foglalasaim');
  await expect(shipperPage.getByText(/Kézbesítve/).first()).toBeVisible({ timeout: 20_000 });
  await expect(shipperPage.getByText(/közvetlenül a szállítónak jár/).first()).toBeVisible();

  // --- 4. DB-végállapot ---
  const { rows: final } = await dbQuery(
    'SELECT status, delivered_at FROM route_bookings WHERE id = $1', [booking.id],
  );
  expect(final[0].status).toBe('delivered');
  expect(final[0].delivered_at).toBeTruthy();

  await carrierCtx.close();
  await shipperCtx.close();
});

test('mobil: vitás foglalás látható marad, kézbesíthető, a vita és a fotómegőrzés nyitva marad', async ({ browser }) => {
  const { shipper, carrier, route, booking, code } = await createPaidBooking();
  const carrierCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const shipperCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  try {
    const carrierPage = await carrierCtx.newPage();
    const shipperPage = await shipperCtx.newPage();
    await loginAs(carrierPage, carrier);
    await loginAs(shipperPage, shipper);
    await carrierPage.goto(`/sofor/utvonal/${route.id}`);
    await shipperPage.goto('/fuvarjaim?tab=foglalasaim');
    const pin = shipperPage.getByTitle('Átvételi kód – add át a szállítónak');
    await expect(pin).toContainText(code);

    const idPrefix = `b-${booking.id.slice(0, 8)}-`;
    await carrierPage.locator(`#${idPrefix}pickup-photo`).setInputFiles({
      name: 'felvetel.png', mimeType: 'image/png', buffer: TINY_PNG,
    });
    await carrierPage.getByRole('button', { name: /Felvétel igazolása/ }).click();
    await expect(carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ })).toBeVisible();

    const dispute = await apiPost(shipper.token, '/disputes', {
      booking_id: booking.id,
      description: 'A csomag sérült, de az átadást szeretnénk dokumentálni.',
    });
    // A szállító a valódi értesítésből frissül; a vitát API-n nyitó feladó
    // újratölti a saját listáját, ahogy egy későbbi visszalépéskor tenné.
    await expect(carrierPage.getByText('Vitatott', { exact: true })).toBeVisible();
    await shipperPage.reload();
    await expect(shipperPage.getByText('Vitatott', { exact: true })).toBeVisible();
    await expect(pin).toContainText(code);
    await expect(carrierPage.getByText(/A vita nyitva marad/)).toBeVisible();

    await carrierPage.locator(`#${idPrefix}dropoff-photo`).setInputFiles({
      name: 'atadas.png', mimeType: 'image/png', buffer: TINY_PNG,
    });
    await carrierPage.getByPlaceholder('6 számjegy').fill(code);
    await carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ }).click();
    for (const page of [carrierPage, shipperPage]) {
      await expect(page.getByText(/Kézbesítve/).first()).toBeVisible();
      await expect(page.getByText('Vitatott', { exact: true })).toBeVisible();
      await expect(page.getByText(/A vita nyitva marad/)).toBeVisible();
    }
    await expect(pin).toHaveCount(0);
    await expect(carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ })).toHaveCount(0);
    const { rows } = await dbQuery(
      `SELECT b.status, b.status_before_dispute, b.photo_retention_hold, b.delivered_at,
              d.status AS dispute_status,
              (SELECT count(*)::int FROM photos WHERE booking_id = b.id) AS photo_count
         FROM route_bookings b JOIN disputes d ON d.booking_id = b.id
        WHERE b.id = $1 AND d.id = $2`, [booking.id, dispute.id],
    );
    expect(rows[0]).toMatchObject({
      status: 'disputed', status_before_dispute: 'delivered',
      photo_retention_hold: true, dispute_status: 'open', photo_count: 2,
    });
    expect(rows[0].delivered_at).toBeTruthy();
  } finally {
    await carrierCtx.close();
    await shipperCtx.close();
  }
});
