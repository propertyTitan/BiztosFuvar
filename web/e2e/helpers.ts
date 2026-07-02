// Közös E2E helperek: user/fuvar gyártás a backend API-n + közvetlen DB-n
// keresztül, és bejelentkeztetés a böngészőbe localStorage-injektálással.
import crypto from 'crypto';
import { Page } from '@playwright/test';
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

async function dbQuery(sql: string, params: unknown[] = []) {
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
  role: 'shipper' | 'carrier' = 'shipper',
  name = 'Teszt Elek',
): Promise<E2EUser> {
  seq += 1;
  const email = `e2e-${Date.now()}-${seq}@teszt.gofuvar.hu`;
  const password = 'Jelszo123!';
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;

  const { rows } = await dbQuery(
    `INSERT INTO users (role, email, password_hash, full_name, phone,
                        identity_kyc_status, driver_kyc_status)
     VALUES ($1, $2, $3, $4, '+36201234567', 'verified', 'verified')
     RETURNING id, role`,
    [role, email, passwordHash, name],
  );

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login hiba: ${res.status} ${await res.text()}`);
  const body = await res.json();

  return { id: rows[0].id, email, role: rows[0].role, full_name: name, token: body.token };
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
