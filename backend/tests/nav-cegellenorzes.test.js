// NAV adószám-ellenőrzés ("Ellenőrzött cég" jelvény) — a teljes integráció
// implementálva van, élesben csak a NAV technikai felhasználó env-jei
// hiányoznak. Itt a NAV HTTP-hívást mockoljuk (global.fetch), és a teljes
// láncot teszteljük: XML-építés, aláírás, válasz-értelmezés, névegyeztetés,
// DB-frissítés, végpont-viselkedés.
import {
  describe, it, expect, beforeEach, afterEach, vi,
} from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const nav = require('../src/services/navTaxpayer');

const NAV_ENV = {
  NAV_ONLINE_LOGIN: 'teszt-technikai-user',
  NAV_ONLINE_PASSWORD: 'teszt-jelszo',
  NAV_ONLINE_SIGNKEY: 'teszt-alairo-kulcs',
  NAV_ONLINE_TAXNUMBER: '24750792',
};

function setNavEnv() {
  Object.assign(process.env, NAV_ENV);
}
function clearNavEnv() {
  for (const k of Object.keys(NAV_ENV)) delete process.env[k];
}

/** NAV queryTaxpayer válasz-XML (sikeres lekérdezés). */
function navResponseXml({ valid = true, name = 'TISZTA HÓD KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG', shortName = 'TISZTA HÓD KFT.' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<QueryTaxpayerResponse xmlns="http://schemas.nav.gov.hu/OSA/3.0/api">
  <ns2:result xmlns:ns2="http://schemas.nav.gov.hu/NTCA/1.0/common">
    <ns2:funcCode>OK</ns2:funcCode>
  </ns2:result>
  <taxpayerValidity>${valid}</taxpayerValidity>
  <taxpayerData>
    <taxpayerName>${name}</taxpayerName>
    <taxpayerShortName>${shortName}</taxpayerShortName>
  </taxpayerData>
</QueryTaxpayerResponse>`;
}

/** Válasz nem létező adószámra: funcCode OK, de nincs taxpayerValidity. */
function navNotFoundXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<QueryTaxpayerResponse xmlns="http://schemas.nav.gov.hu/OSA/3.0/api">
  <ns2:result xmlns:ns2="http://schemas.nav.gov.hu/NTCA/1.0/common">
    <ns2:funcCode>OK</ns2:funcCode>
  </ns2:result>
</QueryTaxpayerResponse>`;
}

function mockNavFetch(xml, { status = 200 } = {}) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => xml,
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function createCompanyUser({ companyName = 'Tiszta Hód Kft.', taxId = '24750792-2-06' } = {}) {
  const user = await createUser();
  await db.query(
    `UPDATE users SET account_type = 'company', company_name = $2, tax_id = $3,
                      company_verification_status = 'pending'
      WHERE id = $1`,
    [user.id, companyName, taxId],
  );
  return user;
}

function verifyCall(token) {
  return request(app).post('/auth/verify-company').set('Authorization', `Bearer ${token}`).send({});
}

afterEach(() => {
  clearNavEnv();
  vi.unstubAllGlobals();
});

describe('Cégnév-normalizálás és egyeztetés', () => {
  it('hosszú cégforma ↔ rövidítés + ékezetek: egyezik', () => {
    expect(nav.companyNamesMatch(
      'Tiszta Hód Kft.',
      'TISZTA HÓD KORLÁTOLT FELELŐSSÉGŰ TÁRSASÁG',
      null,
    )).toBe(true);
  });

  it('a rövid név (shortName) alapján is egyezik', () => {
    expect(nav.companyNamesMatch('Tiszta Hód Kft.', 'VALAMI EGÉSZEN MÁS ZRT.', 'TISZTA HÓD KFT.')).toBe(true);
  });

  it('más cég neve NEM egyezik (adószám-visszaélés védelem)', () => {
    expect(nav.companyNamesMatch('Kamu Fuvar Bt.', 'TISZTA HÓD KFT.', 'TISZTA HÓD KFT.')).toBe(false);
  });

  it('túl rövid megkülönböztető név nem adhat egyezést', () => {
    expect(nav.companyNamesMatch('Kft.', 'TISZTA HÓD KFT.', null)).toBe(false);
  });
});

describe('NAV kérés-összeállítás', () => {
  it('a requestSignature SHA3-512 (128 hex, nagybetű), a maszk yyyyMMddHHmmss', () => {
    const sig = nav.computeRequestSignature('RID1', '2026-07-19T10:00:00.000Z', 'kulcs');
    expect(sig).toMatch(/^[0-9A-F]{128}$/);
    expect(nav.timestampMask('2026-07-19T10:00:00.000Z')).toBe('20260719100000');
  });

  it('az XML tartalmazza a technikai usert, a saját és a lekérdezett adószámot', () => {
    setNavEnv();
    const xml = nav.buildQueryTaxpayerXml({
      taxNumber8: '12345678', requestId: 'RID1', timestamp: '2026-07-19T10:00:00.000Z',
    });
    expect(xml).toContain('<common:login>teszt-technikai-user</common:login>');
    expect(xml).toContain('<common:taxNumber>24750792</common:taxNumber>');
    expect(xml).toContain('<taxNumber>12345678</taxNumber>');
    expect(xml).toContain('cryptoType="SHA-512"');
    expect(xml).toContain('cryptoType="SHA3-512"');
  });
});

describe('POST /auth/verify-company', () => {
  it('nem céges fióknak: not_company (nincs 500)', async () => {
    const user = await createUser();
    const res = await verifyCall(user.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_company');
  });

  it('NAV-env nélkül: not_configured — a végpont él, csak az API hiányzik', async () => {
    const user = await createCompanyUser();
    const res = await verifyCall(user.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_configured');
  });

  it('érvényes adószám + egyező cégnév → verified + jelvény a DB-ben', async () => {
    setNavEnv();
    const fetchMock = mockNavFetch(navResponseXml());
    const user = await createCompanyUser();

    const res = await verifyCall(user.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('verified');

    const { rows } = await db.query(
      `SELECT company_verification_status, nav_taxpayer_valid, nav_taxpayer_name
         FROM users WHERE id = $1`, [user.id],
    );
    expect(rows[0].company_verification_status).toBe('verified');
    expect(rows[0].nav_taxpayer_valid).toBe(true);
    expect(rows[0].nav_taxpayer_name).toContain('TISZTA HÓD');

    // A NAV-ot a helyes végponton hívtuk
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/queryTaxpayer');
  });

  it('érvényes adószám, de MÁS cégnév → name_mismatch, a státusz NEM verified', async () => {
    setNavEnv();
    mockNavFetch(navResponseXml({ name: 'TELJESEN MÁS CÉG ZRT.', shortName: 'MÁS CÉG ZRT.' }));
    const user = await createCompanyUser({ companyName: 'Kamu Fuvar Bt.' });

    const res = await verifyCall(user.token);
    expect(res.body.status).toBe('name_mismatch');

    const { rows } = await db.query(
      `SELECT company_verification_status, nav_taxpayer_name FROM users WHERE id = $1`, [user.id],
    );
    expect(rows[0].company_verification_status).toBe('pending');
    // Az admin látja, mit mond a NAV — kézzel dönthet
    expect(rows[0].nav_taxpayer_name).toContain('MÁS CÉG');
  });

  it('nem létező adószám → invalid, nav_taxpayer_valid=false', async () => {
    setNavEnv();
    mockNavFetch(navNotFoundXml());
    const user = await createCompanyUser({ taxId: '99999999-1-11' });

    const res = await verifyCall(user.token);
    expect(res.body.status).toBe('invalid');

    const { rows } = await db.query(
      `SELECT company_verification_status, nav_taxpayer_valid FROM users WHERE id = $1`, [user.id],
    );
    expect(rows[0].nav_taxpayer_valid).toBe(false);
    expect(rows[0].company_verification_status).toBe('pending');
  });

  it('NAV-hiba (5xx) esetén error státusz — sosem 500 a mi oldalunkon', async () => {
    setNavEnv();
    mockNavFetch('<GeneralErrorResponse><errorCode>MAINTENANCE</errorCode></GeneralErrorResponse>', { status: 500 });
    const user = await createCompanyUser();

    const res = await verifyCall(user.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('error');
  });

  it('gonosz input a body-ban: a végpont figyelmen kívül hagyja, nincs 500', async () => {
    const user = await createCompanyUser();
    const res = await request(app)
      .post('/auth/verify-company')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ tax_id: { $ne: null }, garbage: 'x'.repeat(100000) });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('not_configured');
  });
});

describe('Jelvény-kitettség a többi végponton', () => {
  it('a publikus profil adja az account_type + company mezőket', async () => {
    setNavEnv();
    mockNavFetch(navResponseXml());
    const company = await createCompanyUser();
    await verifyCall(company.token);

    const viewer = await createUser();
    const res = await request(app)
      .get(`/auth/users/${company.id}/profile`)
      .set('Authorization', `Bearer ${viewer.token}`);
    expect(res.status).toBe(200);
    expect(res.body.account_type).toBe('company');
    expect(res.body.company_verification_status).toBe('verified');
    expect(res.body.company_name).toBe('Tiszta Hód Kft.');
  });

  it('a GET /auth/me jelzi, elérhető-e a NAV-ellenőrzés (company_nav_available)', async () => {
    const user = await createCompanyUser();
    const before = await request(app).get('/auth/me').set('Authorization', `Bearer ${user.token}`);
    expect(before.body.company_nav_available).toBe(false);

    setNavEnv();
    const after = await request(app).get('/auth/me').set('Authorization', `Bearer ${user.token}`);
    expect(after.body.company_nav_available).toBe(true);
  });
});
