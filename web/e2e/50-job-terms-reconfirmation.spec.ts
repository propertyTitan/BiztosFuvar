import { test, expect } from '@playwright/test';
import { API_URL, createUser, createJob, placeBid, loginAs, getJobRow } from './helpers';

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test(`módosított fuvar → szállítói megerősítés → elfogadás (${viewport.width}px)`, async ({ browser, request }) => {
    const shipper = await createUser('shipper'), carrier = await createUser('carrier');
    const job = await createJob(shipper);
    await placeBid(carrier, job.id, 20000);
    const shipperContext = await browser.newContext({ viewport }), carrierContext = await browser.newContext({ viewport });
    try {
      const sp = await shipperContext.newPage(), cp = await carrierContext.newPage();
      await loginAs(sp, shipper); await loginAs(cp, carrier);
      await sp.goto(`/dashboard/fuvar/${job.id}`);
      await cp.goto(`/sofor/fuvar/${job.id}`);
      await expect(sp.getByRole('button', { name: /^Elfogadom/ })).toBeVisible();
      await expect(cp.getByText('Várakozik elfogadásra')).toBeVisible();
      const edit = await request.patch(`${API_URL}/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${shipper.token}` },
        data: { weight_kg: 300, pickup_needs_carrying: true, pickup_floor: 5 },
      });
      expect(edit.status()).toBe(200);
      // A feladó privát fuvar-szobán, a függő ajánlattevő saját user-szobán frissül.
      await expect(sp.getByText(/A szállító megerősítésére vár/)).toBeVisible();
      await expect(sp.getByRole('button', { name: /^Elfogadom/ })).toHaveCount(0);
      await expect(cp.getByRole('heading', { name: 'Erősítsd meg az ajánlatodat' })).toBeVisible();
      await cp.getByRole('button', { name: 'Korábbi ajánlat betöltése' }).click();
      await cp.getByPlaceholder('pl. 58000').fill('30000');
      const submit = cp.getByRole('button', { name: 'Ajánlat megerősítése a jelenlegi feltételekre' });
      await expect(submit).toBeDisabled();
      await cp.getByRole('button', { name: 'Átnéztem a frissített fuvaradatokat' }).click();
      await submit.click();
      await expect(cp.getByText('Várakozik elfogadásra')).toBeVisible();
      await expect(sp.getByText(/A szállító megerősítésére vár/)).toHaveCount(0);
      await sp.getByRole('button', { name: /^Elfogadom/ }).click();
      await expect.poll(async () => (await getJobRow(job.id)).status).toBe('accepted');
      const result = await getJobRow(job.id);
      expect(Number(result.accepted_price_huf)).toBe(30000);
      expect(Number(result.weight_kg)).toBe(300);
      expect(result.carrier_id).toBe(carrier.id);
      expect(await cp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally { await shipperContext.close(); await carrierContext.close(); }
  });
}
