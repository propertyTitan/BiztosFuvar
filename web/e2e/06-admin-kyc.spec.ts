// Admin KYC kézi jóváhagyás: a függő dokumentum megjelenik az admin
// felületen, a jóváhagyás után a user identity-KYC-je verified.
import { test, expect } from '@playwright/test';
import { createUser, dbQuery, loginAs } from './helpers';

test('admin jóváhagyja a függő KYC-dokumentumot → a user verified lesz', async ({ page }) => {
  const applicant = await createUser('shipper', 'Kyc Kázmér', 'pending');
  await dbQuery(
    // A `full_name_on_doc` oszlop 2026-08-10-én TÖRÖLVE (066-os migráció):
    // halott PII-séma volt, egyetlen élő út sem írta.
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
     VALUES ($1, 'id_card', '/uploads/e2e-kyc-teszt.png', 'pending')`,
    [applicant.id],
  );
  const admin = await createUser('admin', 'Admin Aladár');

  await loginAs(page, admin);
  await page.goto('/admin#kyc'); // KYC fül (admin v2: füles felület)

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

test('a közben kicserélt okmányhoz új megtekintés és új döntés szükséges', async ({ page }) => {
  const applicant = await createUser('carrier', 'Kyc Friss Fanni', 'pending');
  const { rows } = await dbQuery(`INSERT INTO kyc_documents(user_id,doc_type,file_url,status)
    VALUES($1,'id_card','/uploads/e2e-kyc-old.png','pending') RETURNING id`, [applicant.id]);
  const admin = await createUser('admin', 'Kyc Ellenőr');
  await loginAs(page, admin);
  await page.goto('/admin#kyc');
  const card = page.locator('.card', { hasText: 'Kyc Friss Fanni' }).first();
  await expect(card.getByRole('button', { name: 'Jóváhagyom' })).toBeVisible();
  await dbQuery(`UPDATE kyc_documents SET file_url='/uploads/e2e-kyc-new.png', uploaded_at=NOW()
    WHERE id=$1`, [rows[0].id]);
  await card.getByRole('button', { name: 'Jóváhagyom' }).click();
  await expect(page.getByText(/Az okmány vagy a profil időközben megváltozott/)).toBeVisible();
  await expect(card.locator('img')).toHaveAttribute('src', /e2e-kyc-new\.png/);
  expect((await dbQuery('SELECT identity_kyc_status FROM users WHERE id=$1', [applicant.id])).rows[0].identity_kyc_status).toBe('pending');
  await card.getByRole('button', { name: 'Jóváhagyom' }).click();
  await expect(page.getByText('Jóváhagyva').first()).toBeVisible();
  expect((await dbQuery('SELECT identity_kyc_status FROM users WHERE id=$1', [applicant.id])).rows[0].identity_kyc_status).toBe('verified');
});
