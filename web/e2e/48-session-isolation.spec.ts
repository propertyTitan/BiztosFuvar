import { test, expect, type Page } from '@playwright/test';
import { API_URL, createUser, dbQuery, type E2EUser } from './helpers';

// Csak helyi fixture-fiókok; emailküldés kifejezetten kikapcsolva.
async function dm(admin: E2EUser, target: E2EUser, body: string) {
  const response = await fetch(`${API_URL}/admin/dm/with/${target.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ body, send_email: false }),
  });
  expect(response.status, await response.text()).toBe(201);
}

async function realLogin(page: Page, user: E2EUser) {
  await page.goto('/bejelentkezes');
  const consent = page.getByRole('button', { name: 'Rendben, értem' });
  if (await consent.isVisible()) await consent.click();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Jelszó', { exact: true }).fill('Jelszo123!');
  await page.getByRole('button', { name: 'Belépés →', exact: true }).click();
  await expect(page).toHaveURL(/localhost:3100\/$/);
  await expect(page.getByRole('button', { name: 'Fiókmenü' })).toBeVisible();
}

test('A07: másik tab logout/login után A privát eseménye nem jut át, B saját eseménye megérkezik', async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  const a = await createUser('shipper', 'Anna Tabteszt');
  const b = await createUser('shipper', 'Bea Tabteszt');
  const admin = await createUser('admin', 'Admin Tabteszt');
  const frames: string[] = [];
  const lifecycle: Array<{ kind: string; at: number }> = [];
  page.on('websocket', socket => {
    lifecycle.push({ kind: 'open', at: Date.now() });
    socket.on('framereceived', event => frames.push(String(event.payload)));
    socket.on('close', () => lifecycle.push({ kind: 'close', at: Date.now() }));
  });

  await realLogin(page, a);
  const control = await context.newPage();
  await control.goto('/');
  await expect(control.getByRole('button', { name: 'Fiókmenü' })).toBeVisible();
  const warm = `Anna kezdeti privát próba ${Date.now()}`;
  await dm(admin, a, warm);
  await expect(page.getByText(warm, { exact: true })).toBeVisible();
  const versionBefore = (await dbQuery('SELECT token_version FROM users WHERE id=$1', [a.id])).rows[0].token_version;

  await control.getByRole('button', { name: 'Fiókmenü' }).click();
  await control.getByRole('button', { name: 'Kijelentkezés', exact: true }).click();
  await expect(control).toHaveURL(/bejelentkezes/);
  await realLogin(control, b);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gofuvar_user') || '{}').id)).toBe(b.id);
  await page.getByRole('button', { name: 'Fiókmenü' }).click();
  await expect(page.getByText('Bea', { exact: true })).toBeVisible();
  const versionAfter = (await dbQuery('SELECT token_version FROM users WHERE id=$1', [a.id])).rows[0].token_version;

  const privateMessage = `Csak Anna olvashatja ${Date.now()}`;
  const bControl = `Bea saját ellenőrző üzenete ${Date.now()}`;
  await dm(admin, a, privateMessage);
  await dm(admin, b, bControl);
  await expect(control.getByText(bControl, { exact: true })).toBeVisible();
  // A régi tab B élő szobájába is belépett, nem csupán A-t némította el.
  await expect(page.getByText(bControl, { exact: true })).toBeVisible();
  await page.waitForTimeout(750);
  const evidence = {
    a: a.id, b: b.id, versionBefore, versionAfter,
    currentUser: await page.evaluate(() => JSON.parse(localStorage.getItem('gofuvar_user') || '{}').id),
    pageUrl: page.url(),
    aNotificationFrame: frames.some(frame => frame.includes(privateMessage)),
    aNotificationVisible: await page.getByText(privateMessage, { exact: true }).isVisible(),
    bNotificationFrame: frames.some(frame => frame.includes(bControl)),
    socketLifecycle: lifecycle,
    notificationFrames: frames.filter(frame => frame.includes('notification:new')),
  };
  await testInfo.attach('cross-tab-session-evidence', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  // Azonnali értékek: a polling locator assertion kivárná a tiltott toast eltűnését!
  expect(evidence.aNotificationFrame).toBe(false);
  expect(evidence.aNotificationVisible).toBe(false);
  expect(evidence.bNotificationFrame).toBe(true);
});
