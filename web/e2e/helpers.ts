// Közös E2E helperek: user/fuvar gyártás a backend API-n + közvetlen DB-n
// keresztül, és bejelentkeztetés a böngészőbe localStorage-injektálással.
import crypto from 'crypto';
import { expect, Locator, Page } from '@playwright/test';
import { Client } from 'pg';

export const API_URL = 'http://localhost:4100';
const DB_URL = 'postgres://gofuvar:gofuvar@127.0.0.1:54332/gofuvar_test';

let seq = 0;

export type E2EUser = {
  id: string;
  email: string;
  role: string;
  full_name: string;
  token: string;
};

export async function dbQuery(sql: string, params: unknown[] = []) {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

/** User közvetlen DB-inserttel (a regisztrációs API óránként 5 fiók/IP
 *  limitje miatt azt csak a regisztrációt tesztelő teszt hívja). A jelszó
 *  ugyanabban a scrypt `salt:derived` formátumban készül, mint élesben,
 *  így a login űrlap is működik vele; a token a backend /auth/login-jából
 *  jön — valódi, aláírt JWT. */
export async function createUser(
  role: 'shipper' | 'carrier' | 'admin' = 'shipper',
  name = 'Teszt Elek',
  kyc: 'verified' | 'pending' | 'none' = 'verified',
): Promise<E2EUser> {
  seq += 1;
  const email = `e2e-${Date.now()}-${seq}@teszt.gofuvar.hu`;
  const password = 'Jelszo123!';
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;

  const { rows } = await dbQuery(
    `INSERT INTO users (role, email, password_hash, full_name, phone,
                        identity_kyc_status, driver_kyc_status, driver_terms_accepted_at)
     VALUES ($1, $2, $3, $4, '+36201234567', $5, $5,
             CASE WHEN $5 = 'verified' THEN NOW() ELSE NULL END)
     RETURNING id, role`,
    [role, email, passwordHash, name, kyc],
  );

  // A tokent helyben írjuk alá (HS256) a playwright.config.ts-ben rögzített
  // teszt-JWT_SECRET-tel — a /auth/login hívogatása a perc/IP login-limitbe
  // ütközne, amikor a suite tucatnyi usert gyárt.
  const token = signTestJwt({ sub: rows[0].id, role: rows[0].role, email });

  return { id: rows[0].id, email, role: rows[0].role, full_name: name, token };
}

const E2E_JWT_SECRET = 'e2e-jwt-titok-nem-eles';

function signTestJwt(payload: Record<string, unknown>) {
  const b64url = (buf: Buffer) => buf.toString('base64url');
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(
    Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 3600 })),
  );
  const signature = b64url(
    crypto.createHmac('sha256', E2E_JWT_SECRET).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${signature}`;
}

/** Bejelentkeztetés böngészőbe: ugyanaz a localStorage-állapot, amit a
 *  login oldal (src/lib/auth.ts setCurrentUser) írna. */
export async function loginAs(page: Page, user: E2EUser) {
  await page.addInitScript(
    ({ u, token }) => {
      window.localStorage.setItem('gofuvar_user', JSON.stringify(u));
      window.localStorage.setItem('gofuvar_token', token);
      // A süti-banner ne takarjon el gombokat a tesztben
      window.localStorage.setItem('gofuvar_cookie_consent', JSON.stringify({ necessary: true }));
    },
    {
      u: { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
      token: user.token,
    },
  );
}

/** Fuvar létrehozása a feladó nevében a valódi POST /jobs végponton. */
export async function createJob(shipper: E2EUser, overrides: Record<string, unknown> = {}) {
  const res = await fetch(`${API_URL}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${shipper.token}`,
    },
    body: JSON.stringify({
      title: 'E2E teszt fuvar — dobozok',
      description: 'Playwright teszt',
      pickup_address: 'Budapest, Váci út 1.',
      pickup_lat: 47.5104,
      pickup_lng: 19.0621,
      dropoff_address: 'Szeged, Kossuth Lajos sugárút 1.',
      dropoff_lat: 46.2546,
      dropoff_lng: 20.1443,
      weight_kg: 5,
      length_cm: 40,
      width_cm: 30,
      height_cm: 20,
      suggested_price_huf: 15000,
      recipient_name: 'Címzett Cecília',
      recipient_phone: '+36301112233',
      ...overrides,
    }),
  });
  if (!res.ok) throw new Error(`job létrehozás hiba: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Fuvar "elfogadva" állapotba állítása közvetlen DB-vel — az elfogadás /
 *  fizetés flow-t a 02-es teszt fedi, a többi teszt kész állapotból indul. */
export async function setJobAccepted(
  jobId: string,
  carrierId: string,
  { paid = true, priceHuf = 20000, status = 'accepted' as string } = {},
) {
  // Készpénzes modell: paid = a KAPCSOLATFELVÉTELI díj fizetve (sávos díj),
  // a díj-sor 'released' (a szolgáltatás a kontakt-átadással teljesült).
  const feeHuf = connectionFee(priceHuf);
  await dbQuery(
    `UPDATE jobs SET carrier_id = $2, status = $3, accepted_price_huf = $4,
            connection_fee_huf = $6,
            paid_at = CASE WHEN $5 THEN NOW() ELSE NULL END,
            fee_consent_at = CASE WHEN $5 THEN NOW() ELSE NULL END
      WHERE id = $1`,
    [jobId, carrierId, status, priceHuf, paid, feeHuf],
  );
  if (paid) {
    await dbQuery(
      `INSERT INTO escrow_transactions
         (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf, released_at)
       VALUES ($1, $2, 'released', $3, 0, $2, NOW())
       ON CONFLICT (job_id) DO NOTHING`,
      [jobId, feeHuf, `stub-${jobId}`],
    );
  }
}

/** A backend connectionFee sávjainak tükre (ÁSZF 4.1) — a tesztek elvárásaihoz. */
export function connectionFee(priceHuf: number): number {
  if (priceHuf <= 20000) return 500;
  if (priceHuf <= 50000) return 1490;
  if (priceHuf <= 100000) return 2490;
  return 3990;
}

/** Sofőr-licit közvetlenül az API-n (a licit-űrlapot a 02-es teszt fedi). */
export async function placeBid(carrier: E2EUser, jobId: string, amountHuf: number) {
  const res = await fetch(`${API_URL}/jobs/${jobId}/bids`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${carrier.token}` },
    body: JSON.stringify({ amount_huf: amountHuf, return_policy: 'included' }),
  });
  if (!res.ok) throw new Error(`licit hiba: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Cím kiválasztása a Google Places legördülőből, retry-jal. A sikerét a
 *  formázott cím megjelenése igazolja (irányítószám/ország a gépelt
 *  szövegben nincs) — csak ekkor kapott koordinátát az űrlap. */
export async function selectAddress(page: Page, input: Locator, query: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await input.click();
    await input.fill('');
    await input.pressSequentially(query, { delay: 80 });
    try {
      await expect(page.locator('.pac-item:visible').first()).toBeVisible({ timeout: 7_000 });
      await input.press('ArrowDown');
      await input.press('Enter');
      await expect(input).toHaveValue(/(\d{4}|Magyarország|Hungary)/, { timeout: 7_000 });
      return;
    } catch {
      // újrapróbáljuk — hideg dev-szervernél az első próbán még akadozhat
    }
  }
  throw new Error(`Cím-kiválasztás sikertelen 3 próbából: ${query}`);
}

/** A címzett 6 jegyű átvételi kódja — amit élesben SMS-ben kapna. */
export async function getDeliveryCode(jobId: string): Promise<string> {
  const { rows } = await dbQuery('SELECT delivery_code FROM jobs WHERE id = $1', [jobId]);
  return rows[0].delivery_code;
}

export async function getJobRow(jobId: string) {
  const { rows } = await dbQuery('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return rows[0];
}

/** 1×1 pixeles PNG a fotó-feltöltésekhez. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
