import { test, expect } from '@playwright/test';
import { API_URL, createUser, createJob, placeBid, getJobRow, loginAs, setJobAccepted, TINY_PNG } from './helpers';

for (const role of ['shipper', 'carrier'] as const) {
  test(`${role}: az elfogadás alatt változó árhoz új kattintás kell`, async ({ page }) => {
    const shipper = await createUser('shipper');
    const carrier = await createUser('carrier');
    const job = await createJob(shipper);
    const bid = await placeBid(carrier, job.id, 20000);
    const actor = role === 'shipper' ? shipper : carrier;
    const author = role === 'shipper' ? carrier : shipper;
    const counter = (amount: number) => fetch(`${API_URL}/bids/${bid.id}/counter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${author.token}` },
      body: JSON.stringify({ amount }),
    });
    expect((await counter(20000)).status).toBe(200);
    await loginAs(page, actor);
    await page.goto(`/${role === 'shipper' ? 'dashboard' : 'sofor'}/fuvar/${job.id}`);
    const endpoint = `${API_URL}/bids/${bid.id}/${role === 'shipper' ? 'accept' : 'accept-counter'}`;
    let requests = 0;
    await page.route(endpoint, async route => {
      requests += 1;
      if (requests === 1) {
        expect(route.request().postDataJSON()).toEqual({ expected_revision: 2, expected_amount_huf: 20000 });
        // A már elküldött elfogadást késleltetjük egy másik fél új ajánlatával.
        expect((await counter(50000)).status).toBe(200);
      }
      await route.continue();
    });
    const rejected = page.waitForResponse(r => r.url() === endpoint && r.status() === 409);
    await page.getByRole('button', { name: /Elfogadom/ }).click();
    await rejected;
    await expect(page.getByRole('button', { name: /Elfogadom.*50\s?000/ })).toBeVisible();
    expect(requests).toBe(1);
    expect((await getJobRow(job.id)).status).toBe('bidding');
    const accepted = page.waitForResponse(r => r.url() === endpoint && r.status() === 200);
    await page.getByRole('button', { name: /Elfogadom.*50\s?000/ }).click();
    await accepted;
    const final = await getJobRow(job.id);
    expect(final.status).toBe('accepted'); expect(final.accepted_price_huf).toBe(50000);
  });
}

test('mobilon vita közben is kézbesíthető a csomag a feladó képernyőjén látható saját PIN-nel', async ({ browser }) => {
  const shipper = await createUser('shipper');
  const carrier = await createUser('carrier');
  const job = await createJob(shipper, { recipient_name: undefined, recipient_phone: undefined });
  await setJobAccepted(job.id, carrier.id, { paid: true });
  const senderContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const carrierContext = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const senderPage = await senderContext.newPage();
    const carrierPage = await carrierContext.newPage();
    await loginAs(senderPage, shipper); await loginAs(carrierPage, carrier);
    await carrierPage.goto(`/sofor/fuvar/${job.id}`);
    await carrierPage.locator('#pickup-photo').setInputFiles({ name: 'pickup.png', mimeType: 'image/png', buffer: TINY_PNG });
    await carrierPage.getByRole('button', { name: /Felvétel igazolása/ }).click();
    await expect(carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ })).toBeVisible();
    await senderPage.goto(`/dashboard/fuvar/${job.id}`);
    await senderPage.getByRole('button', { name: /Vitás esetet nyitok/ }).click();
    await senderPage.locator('textarea').last().fill('Az átadás részleteit egyeztetni kell, a csomag közben kézbesíthető.');
    await senderPage.getByRole('button', { name: /^Vita megnyitása$/ }).click();
    await expect(senderPage.getByText('Vitatott', { exact: true }).first()).toBeVisible();
    // Friss belépéskor is működik, nem csak a vita előtti képernyőn maradt kóddal.
    await senderPage.reload(); await carrierPage.reload();
    await expect(senderPage.getByText(/Átvételi kódod/)).toBeVisible();
    const pin = (await senderPage.getByText(/^\d{6}$/).innerText()).trim();
    expect(pin).toMatch(/^\d{6}$/);
    await carrierPage.locator('#dropoff-photo').setInputFiles({ name: 'dropoff.png', mimeType: 'image/png', buffer: TINY_PNG });
    await carrierPage.getByPlaceholder('6 számjegy').fill(pin);
    await carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ }).click();
    await expect(carrierPage.getByRole('button', { name: /Kézbesítés igazolása/ })).toHaveCount(0);
    const final = await getJobRow(job.id);
    expect(final.status).toBe('disputed'); expect(final.status_before_dispute).toBe('delivered');
    await senderPage.reload();
    await expect(senderPage.getByText('Vitatott', { exact: true }).first()).toBeVisible();
    await expect(senderPage.getByText(/Átvételi kódod/)).toHaveCount(0);
  } finally { await senderContext.close(); await carrierContext.close(); }
});
