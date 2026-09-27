import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, db, createUser } = require('./helpers');
const nav = require('../src/services/navTaxpayer');
const env = ['NAV_ONLINE_LOGIN', 'NAV_ONLINE_PASSWORD', 'NAV_ONLINE_SIGNKEY', 'NAV_ONLINE_TAXNUMBER'];
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const answer = (name, valid = true) => ({ ok: true, status: 200, text: async () => `<QueryTaxpayerResponse><funcCode>OK</funcCode><taxpayerValidity>${valid}</taxpayerValidity><taxpayerName>${name}</taxpayerName></QueryTaxpayerResponse>` });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function company() {
  const user = await createUser();
  await db.query("UPDATE users SET account_type='company', company_name='Korabbi Fuvar Kft.', tax_id='12345678-1-42', company_verification_status='pending' WHERE id=$1", [user.id]);
  env.forEach(key => vi.stubEnv(key, key === 'NAV_ONLINE_TAXNUMBER' ? '12345678' : 'helyi-teszt'));
  return user;
}

it('profilátírás után a régi sikeres NAV-válasz nem hitelesítheti az új cégadatokat', async () => {
  const user = await company();
  const started = gate(), release = gate();
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
    if (options.body.includes('<taxNumber>12345678</taxNumber>')) {
      started.resolve(); await release.promise; return answer('Korabbi Fuvar Kft.');
    }
    return answer('Uj Fuvar Kft.', false);
  }));
  const verifying = request(app).post('/auth/verify-company').set('Authorization', `Bearer ${user.token}`).send({}).then(r => r);
  await started.promise;
  try {
    const patch = await request(app).patch('/auth/me').set('Authorization', `Bearer ${user.token}`).send({ company_name: 'Uj Fuvar Kft.', tax_id: '99999999-1-42' });
    expect(patch.status).toBe(200);
  } finally { release.resolve(); }
  expect((await verifying).body.status).toBe('stale');
  const current = (await db.query('SELECT company_name,tax_id,company_verification_status FROM users WHERE id=$1', [user.id])).rows[0];
  expect(current).toEqual({ company_name: 'Uj Fuvar Kft.', tax_id: '99999999-1-42', company_verification_status: 'pending' });
});

it.each([true, false])('a régi NAV-válasz (valid=%s) nem írhatja felül az újabb eredmény metaadatait', async oldValid => {
  const user = await company();
  const started = gate(), release = gate();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (++calls === 1) { started.resolve(); await release.promise; return answer('Regi valasz Kft.', oldValid); }
    return answer('Korabbi Fuvar Kft.');
  }));
  const old = nav.verifyCompanyUser(user.id);
  await started.promise;
  try { expect((await nav.verifyCompanyUser(user.id)).status).toBe('verified'); }
  finally { release.resolve(); }
  expect((await old).status).toBe('stale');
  expect((await db.query('SELECT company_verification_status,nav_taxpayer_valid,nav_taxpayer_name FROM users WHERE id=$1', [user.id])).rows[0])
    .toEqual({ company_verification_status: 'verified', nav_taxpayer_valid: true, nav_taxpayer_name: 'Korabbi Fuvar Kft.' });
});

it('a közben meghozott admin-döntést és az oda-vissza átírt cégadatokat is védi a sorverzió', async () => {
  const user = await company();
  const started = gate(), release = gate();
  vi.stubGlobal('fetch', vi.fn(async () => { started.resolve(); await release.promise; return answer('Korabbi Fuvar Kft.'); }));
  const checking = nav.verifyCompanyUser(user.id);
  await started.promise;
  try {
    await db.query("UPDATE users SET company_name='Atmeneti Kft.' WHERE id=$1", [user.id]);
    await db.query("UPDATE users SET company_name='Korabbi Fuvar Kft.', company_verification_status='rejected' WHERE id=$1", [user.id]);
  } finally { release.resolve(); }
  expect((await checking).status).toBe('stale');
  expect((await db.query('SELECT company_verification_status,nav_taxpayer_checked_at FROM users WHERE id=$1', [user.id])).rows[0])
    .toEqual({ company_verification_status: 'rejected', nav_taxpayer_checked_at: null });
});
