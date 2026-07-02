// Admin KYC kézi jóváhagyás: a függő dokumentum megjelenik az admin
// felületen, a jóváhagyás után a user identity-KYC-je verified.
import { test, expect } from '@playwright/test';
import { createUser, dbQuery, loginAs } from './helpers';

test('admin jóváhagyja a függő KYC-dokumentumot → a user verified lesz', async ({ page }) => {
  const applicant = await createUser('shipper', 'Kyc Kázmér', 'pending');
  await dbQuery(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, full_name_on_doc)
     VALUES ($1, 'id_card', '/uploads/e2e-kyc-teszt.png', 'pending', 'Kyc Kázmér')`,
    [applicant.id],
  );
  const admin = await createUser('admin', 'Admin Aladár');

  await loginAs(page, admin);
  await page.goto('/admin');

  // A függő dokumentum látszik a KYC szekcióban
  await expect(page.getByText(/KYC jóváhagyásra vár/).first()).toBeVisible();
  const docCard = page.locator('.card', { hasText: 'Kyc Kázmér' }).first();
  await expect(docCard).toBeVisible();

  await docCard.getByRole('button', { name: /Jóváhagyom/ }).click();
  await expect(page.getByText('Jóváhagyva').first()).toBeVisible({ timeout: 20_000 });

  // DB-végállapot: dokumentum approved + a user identity-KYC verified
  const { rows: docs } = await dbQuery(
    `SELECT status FROM kyc_documents WHERE user_id = $1`, [applicant.id],
  );
  expect(docs[0].status).toBe('approved');
  const { rows: users } = await dbQuery(
    `SELECT identity_kyc_status FROM users WHERE id = $1`, [applicant.id],
  );
  expect(users[0].identity_kyc_status).toBe('verified');
});
