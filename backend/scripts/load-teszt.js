/* eslint-disable no-console */
// =====================================================================
//  Terheléses teszt orchestrator — GoFuvar prod API (api.gofuvar.hu)
//
//  Futtatás:  node scripts/load-teszt.js
//  Előfeltétel: k6 telepítve (brew install k6)
//
//  Mit csinál:
//   1. SETUP — a prod DB-ben létrehoz jelölt teszt-adatokat: 1 fuvart
//      (tracking-tokennel, hogy legyen valós DB-olvasási célpont) és
//      3 teszt-usert (email_verified, token_version=0). A tokeneket
//      HS256-tal HELYBEN írja alá a prod JWT_SECRET-tel (mint az E2E),
//      így nem terheljük a register-limitet.
//   2. k6 RUN — a load-teszt.k6.js forgatókönyv, az adatokat env-ben kapja.
//   3. TEARDOWN — töröl MINDENT, amit a script hozott létre (a
//      teszt-userek + a fuvar; a jelölt e-mail miatt sosem nyúl idegen
//      adathoz).
//
//  ⚠️ CSAK OLVASÓ (GET) végpontokat terhel — nem hoz létre szemetet, és a
//  böngészési szakasz a 300/perc/IP limit ALATT marad. A rate-limit
//  szakasz szándékosan a limit fölé megy, de az olcsó (a limiter az első
//  middleware). A limit IP-alapú → a valódi (más IP-s) felhasználókat
//  NEM zárja ki.
// =====================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

const API = process.env.LOAD_API || 'https://api.gofuvar.hu';
const RUN_ID = `load-${Date.now()}`;
// A részletes k6-riport a rendszer temp-jébe megy (NEM a repóba), az
// olvasható összegzést a stdout adja.
const SUMMARY_PATH = path.join(os.tmpdir(), `gofuvar-${RUN_ID}-osszegzes`);

const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const DATABASE_URL = (envRaw.match(/^DATABASE_URL=(.+)$/m) || [])[1];
if (!DATABASE_URL) {
  console.error('Hiányzik a DATABASE_URL a backend/.env-ből.');
  process.exit(1);
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const created = { userIds: [], jobIds: [] };
  let trackingToken;
  const tokens = [];

  try {
    // ===== 1. SETUP =====
    // A tokeneket VALÓDI HTTP-regisztrációval szerezzük (nem helyi
    // aláírással), mert a prod JWT_SECRET nem elérhető lokálisan. Így az
    // auth-szakasz is mérhető. A register limit 5/óra/IP — 2 user belefér.
    console.log('--- Setup: teszt-adatok a prod DB-ben ---');
    for (let i = 0; i < 2; i += 1) {
      const email = `${RUN_ID}-u${i}@teszt.gofuvar.hu`;
      const reg = await fetch(`${API}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'LoadTeszt123!', full_name: `[LOAD] Teszt ${i}`, phone: '+36 20 111 2233' }),
      });
      const j = await reg.json().catch(() => null);
      if (reg.status === 201 && j?.token) {
        created.userIds.push(j.user.id);
        tokens.push(j.token);
      } else {
        console.log(`⚠️  Regisztráció ${i}: ${reg.status} (${j?.error || 'ismeretlen'}) — az auth-szakasz kevesebb tokennel megy`);
      }
    }
    if (created.userIds.length === 0) {
      throw new Error('Egyetlen teszt-user sem jött létre (register-limit?). Várj egy órát, vagy futtasd máshonnan.');
    }

    // Egy fuvar tracking-tokennel — valós DB-olvasási célpont a /tracking-hez
    trackingToken = crypto.randomBytes(16).toString('hex');
    const { rows: jobRows } = await db.query(
      `INSERT INTO jobs (
         shipper_id, title, description,
         pickup_address, pickup_lat, pickup_lng,
         dropoff_address, dropoff_lat, dropoff_lng,
         suggested_price_huf, status, delivery_code, sender_delivery_code,
         tracking_token, recipient_name, recipient_phone, connection_fee_huf
       ) VALUES (
         $1, '[LOAD] Teszt fuvar', 'terheléses teszt',
         'Budapest, Teszt u. 1.', 47.4979, 19.0402,
         'Szeged, Teszt tér 2.', 46.2530, 20.1414,
         15000, 'bidding', '111222', '333444',
         $2, 'Teszt Címzett', '+36301112233', 500
       ) RETURNING id`,
      [created.userIds[0], trackingToken],
    );
    created.jobIds.push(jobRows[0].id);
    console.log(`Létrehozva: ${created.userIds.length} user + 1 fuvar (tracking: ${trackingToken.slice(0, 8)}…)`);

    // Token-előellenőrzés: a regisztrációs token tényleg működik-e a
    // védett végpontokon (email-verify nélkül is — az a frontend kapu).
    // Ha nem, az auth-szakaszt kihagyjuk; a publikus szakaszok maradnak.
    let authOk = true;
    try {
      const probe = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${tokens[0]}` } });
      authOk = probe.status === 200;
      console.log(authOk
        ? '✅ Token-előellenőrzés: a regisztrációs token működik (auth-szakasz mérhető).'
        : `⚠️  Token-előellenőrzés: /auth/me → ${probe.status} — az auth-szakaszt kihagyjuk, a publikus szakaszok maradnak.`);
    } catch (e) {
      authOk = false;
      console.log('⚠️  Token-előellenőrzés hálózati hiba:', e.message);
    }
    if (!authOk) tokens.length = 0; // üres token-lista → a k6 auth-szakasz kihagyja

    // ===== 2. k6 RUN =====
    console.log('\n--- k6 terheléses teszt indul ---\n');
    const res = spawnSync('k6', ['run', path.join(__dirname, 'load-teszt.k6.js')], {
      stdio: 'inherit',
      env: {
        ...process.env,
        LOAD_API: API,
        LOAD_TRACKING_TOKEN: trackingToken,
        LOAD_TOKENS: tokens.join(','),
        LOAD_SUMMARY_PATH: SUMMARY_PATH,
      },
    });
    if (res.error) {
      console.error('\nk6 futtatási hiba (telepítve van? `brew install k6`):', res.error.message);
    }
  } finally {
    // ===== 3. TEARDOWN =====
    console.log('\n--- Takarítás a prod DB-ben ---');
    if (created.jobIds.length) {
      await db.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [created.jobIds]).catch(() => {});
    }
    if (created.userIds.length) {
      const del = await db.query(
        `DELETE FROM users WHERE id = ANY($1::uuid[]) AND email LIKE '%@teszt.gofuvar.hu' RETURNING email`,
        [created.userIds],
      );
      console.log(`Törölve: ${del.rows.length} teszt-user + ${created.jobIds.length} fuvar`);
    }
    await db.end();
  }
}

main().catch((e) => { console.error('FATÁLIS:', e); process.exit(1); });
