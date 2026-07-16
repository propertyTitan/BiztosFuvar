// Vita (dispute) megnyitása a feladó oldaláról egy kézbesített fuvaron,
// és a vitatott állapot megjelenése.
import { test, expect } from '@playwright/test';
import { createUser, createJob, loginAs } from './helpers';
import { Client } from 'pg';

const DB_URL = 'postgres://gofuvar:gofuvar@127.0.0.1:54332/gofuvar_test';

test('a feladó vitát nyit, az oldal vitatott állapotot mutat', async ({ page }) => {
  const shipper = await createUser('shipper', 'Feladó Ferenc');
  const carrier = await createUser('carrier', 'Szállító Sándor');
  const job = await createJob(shipper);

  // A fuvar előélete (elfogadva → kifizetve → kézbesítve) itt nem a tesztelt
  // flow — közvetlen DB-vel állítjuk be a kiinduló állapotot.
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  await client.query(
    `UPDATE jobs SET carrier_id = $2, status = 'delivered', paid_at = NOW(),
            accepted_price_huf = 12000, delivered_at = NOW()
      WHERE id = $1`,
    [job.id, carrier.id],
  );
  await client.end();

  await loginAs(page, shipper);
  await page.goto(`/dashboard/fuvar/${job.id}`);

  await page.getByRole('button', { name: /Problémám van ezzel a fuvarral/ }).click();
  await expect(page.getByText('Vita megnyitása').first()).toBeVisible();
  await page.locator('textarea').last().fill(
    'E2E teszt: a csomag sérülten érkezett meg, a doboz sarka behorpadt.',
  );
  await page.getByRole('button', { name: /Vita megnyitása/ }).click();

  // A vita rögzült: az oldal vitatott állapotot jelez
  await expect(page.getByText(/vita|vitatott|disputed/i).first()).toBeVisible({ timeout: 20_000 });
});
