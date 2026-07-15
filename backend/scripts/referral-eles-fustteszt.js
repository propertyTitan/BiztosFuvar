// ÉLES füstteszt — ajánlói program a PROD API (api.gofuvar.hu) + prod Neon
// ellen, jelölt teszt-fiókokkal, a végén TELJES takarítással.
// Futtatás: cd backend && node scripts/referral-eles-fustteszt.js
require('dotenv').config();
const { Pool } = require('pg');

const API = 'https://api.gofuvar.hu';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ts = Date.now();
const email = (who) => `jovanygyula+ref-${who}-${ts}@gmail.com`;
const log = (...a) => console.log('   ', ...a);

const createdUsers = [];
const createdJobs = [];

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function insertVerifiedUser(who, role) {
  const { rows } = await pool.query(
    `INSERT INTO users (role, email, password_hash, full_name, identity_kyc_status, driver_kyc_status)
     VALUES ($1,$2,'x',$3,'verified','verified') RETURNING id`,
    [role, email(who), `TESZT ${who}`],
  );
  createdUsers.push(rows[0].id);
  return rows[0].id;
}

async function insertAcceptedJob(shipperId, carrierId, priceHuf) {
  const { rows } = await pool.query(
    `INSERT INTO jobs (shipper_id, carrier_id, title, description,
        pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
        suggested_price_huf, accepted_price_huf, status,
        delivery_code, sender_delivery_code, tracking_token, recipient_name, recipient_phone,
        connection_fee_huf)
     VALUES ($1,$2,'TESZT referral fuvar','x','Budapest',47.5,19.0,'Szeged',46.2,20.1,
        $3,$3,'accepted','111222','333444',encode(gen_random_bytes(16),'hex'),'Teszt Címzett','+36301112233',
        CASE WHEN $3 <= 50000 THEN 500 ELSE 1000 END)
     RETURNING id`,
    [shipperId, carrierId, priceHuf],
  );
  createdJobs.push(rows[0].id);
  return rows[0].id;
}

async function cleanup() {
  try {
    if (createdJobs.length) {
      await pool.query('DELETE FROM escrow_transactions WHERE job_id = ANY($1)', [createdJobs]);
      await pool.query('DELETE FROM photos WHERE job_id = ANY($1)', [createdJobs]);
      await pool.query('DELETE FROM jobs WHERE id = ANY($1)', [createdJobs]);
    }
    if (createdUsers.length) {
      await pool.query('DELETE FROM fee_vouchers WHERE user_id = ANY($1)', [createdUsers]);
      await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [createdUsers]);
      await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUsers]);
    }
    log(`Takarítás kész: ${createdUsers.length} user + ${createdJobs.length} fuvar törölve.`);
  } catch (e) {
    console.error('   ⚠️ Takarítási hiba (kézi ellenőrzés kell!):', e.message);
  }
}

(async () => {
  console.log('\n════════ AJÁNLÓI PROGRAM — ÉLES FÜSTTESZT (api.gofuvar.hu) ════════\n');
  let ok = true;
  try {
    // 1. Anna regisztrál (prod API)
    const regA = await api('/auth/register', { method: 'POST', body: { email: email('anna'), password: 'AnnaJelszo123', full_name: 'TESZT Ajánló Anna' } });
    if (regA.status !== 201) throw new Error(`Anna register HTTP ${regA.status}: ${JSON.stringify(regA.body)}`);
    const anna = { id: regA.body.user.id, token: regA.body.token };
    createdUsers.push(anna.id);
    log('1) Anna regisztrált (prod):', email('anna'));

    // 2. Anna ajánlói linkje (prod endpoint)
    const ref = await api('/auth/referral', { token: anna.token });
    if (ref.status !== 200 || !ref.body.code) throw new Error(`/auth/referral HTTP ${ref.status}: ${JSON.stringify(ref.body)}`);
    log('2) Anna kódja:', ref.body.code, '| link:', ref.body.link);

    // 3. Béla regisztrál Anna kódjával
    const regB = await api('/auth/register', { method: 'POST', body: { email: email('bela'), password: 'BelaJelszo123', full_name: 'TESZT Meghívott Béla', ref: ref.body.code } });
    if (regB.status !== 201) throw new Error(`Béla register HTTP ${regB.status}: ${JSON.stringify(regB.body)}`);
    const bela = { id: regB.body.user.id, token: regB.body.token };
    createdUsers.push(bela.id);
    const { rows: br } = await pool.query('SELECT referred_by FROM users WHERE id = $1', [bela.id]);
    if (br[0].referred_by !== anna.id) throw new Error('referred_by nem Anna!');
    log('3) Béla regisztrált Anna linkjével → referred_by = Anna ✓');

    // 4. KYC (admin-jóváhagyás szimulálva a prod DB-ben)
    await pool.query(`UPDATE users SET identity_kyc_status='verified', driver_kyc_status='verified' WHERE id = ANY($1)`, [[anna.id, bela.id]]);
    const carrierId = await insertVerifiedUser('carrier', 'carrier');
    log('4) Anna + Béla KYC verified; teszt-sofőr létrehozva');

    // 5. Béla teljesít: feladóként kifizeti az első díját (prod API, stub Barion)
    const belaJob = await insertAcceptedJob(bela.id, carrierId, 20000);
    const pay1 = await api(`/jobs/${belaJob}/pay`, { method: 'POST', token: bela.token, body: { consent: true } });
    if (pay1.status !== 200) throw new Error(`Béla /pay HTTP ${pay1.status}: ${JSON.stringify(pay1.body)}`);
    const conf = await api(`/jobs/${belaJob}/confirm-payment`, { method: 'POST', token: bela.token, body: {} });
    if (conf.status !== 200) throw new Error(`Béla /confirm-payment HTTP ${conf.status}: ${JSON.stringify(conf.body)}`);
    log('5) Béla kifizette az első díját (stub Barion) → trigger elsül');

    // 6. Anna kapott egy kupont
    const ref2 = await api('/auth/referral', { token: anna.token });
    log(`6) Anna: meghívott=${ref2.body.totalReferred}, teljesített=${ref2.body.completedReferred}, kupon=${ref2.body.availableVouchers}`);
    if (ref2.body.completedReferred !== 1 || ref2.body.availableVouchers !== 1) throw new Error('Anna nem kapott kupont!');

    // 7. Anna felad és fizet → kupon beváltódik (0 Ft, nincs Barion)
    const annaJob = await insertAcceptedJob(anna.id, carrierId, 15000);
    const pay2 = await api(`/jobs/${annaJob}/pay`, { method: 'POST', token: anna.token, body: { consent: true } });
    if (pay2.status !== 200) throw new Error(`Anna /pay HTTP ${pay2.status}: ${JSON.stringify(pay2.body)}`);
    log(`7) Anna fizet → paid_via_voucher=${pay2.body.paid_via_voucher}, díj=${pay2.body.fee_huf} Ft, gateway=${pay2.body.gateway_url}`);
    if (pay2.body.paid_via_voucher !== true || pay2.body.fee_huf !== 0) throw new Error('A kupon nem váltódott be!');

    const ref3 = await api('/auth/referral', { token: anna.token });
    log(`   Anna kuponja beváltás után: ${ref3.body.availableVouchers} (0 = elhasználva) ✓`);
    if (ref3.body.availableVouchers !== 0) throw new Error('A kupon nem használódott el!');

    console.log('\n════════ ✅ ÉLES: A TELJES KÖR MŰKÖDIK ════════\n');
  } catch (e) {
    ok = false;
    console.error('\n   ❌ HIBA:', e.message, '\n');
  } finally {
    await cleanup();
    await pool.end();
    process.exit(ok ? 0 : 1);
  }
})();
