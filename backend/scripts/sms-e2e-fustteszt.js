// ÉLES SMS end-to-end füstteszt — a PROD API (api.gofuvar.hu) ellen,
// jelölt teszt-fiókokkal, a végén TELJES takarítással.
//
// Mit bizonyít: a teljes felvételi lánc élesben — teszt-fuvar (a megadott
// szám a címzett) → díj-fizetés (stub) → FELVÉTELI FOTÓ feltöltése → a
// szerver a Railway-en lévő SEEME_API_KEY-jel VALÓDI SMS-t küld a
// címzettnek (átvételi kód + sofőr neve). A bizonyíték a telefonodon
// megérkező SMS.
//
// Futtatás:  cd backend && node scripts/sms-e2e-fustteszt.js +36301234567
// (A DATABASE_URL a backend/.env-ből jön; SeeMe-kulcs NEM kell ide —
//  az SMS-t a szerver küldi.)
require('dotenv').config();
const { Pool } = require('pg');

const API = 'https://api.gofuvar.hu';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ts = Date.now();
const email = (who) => `jovanygyula+sms-${who}-${ts}@gmail.com`;
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

// 1×1 px átlátszó PNG — a felvételi fotó feltöltéséhez
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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
  const phone = process.argv[2];
  if (!phone || !/^\+?36\d{9}$/.test(phone.replace(/[\s-]/g, ''))) {
    console.error('Használat: node scripts/sms-e2e-fustteszt.js +36301234567  (magyar mobilszám!)');
    process.exit(1);
  }

  console.log('\n════════ SMS E2E — ÉLES FÜSTTESZT (api.gofuvar.hu) ════════\n');
  let ok = true;
  try {
    // 1. Feladó + sofőr regisztráció a prod API-n (tokenekért), majd KYC a DB-ben
    const regS = await api('/auth/register', { method: 'POST', body: { email: email('felado'), password: 'TesztJelszo123', full_name: 'TESZT SMS Felado' } });
    if (regS.status !== 201) throw new Error(`Feladó register HTTP ${regS.status}: ${JSON.stringify(regS.body)}`);
    const shipper = { id: regS.body.user.id, token: regS.body.token };
    createdUsers.push(shipper.id);

    const regC = await api('/auth/register', { method: 'POST', body: { email: email('sofor'), password: 'TesztJelszo123', full_name: 'Teszt Sofor Sandor' } });
    if (regC.status !== 201) throw new Error(`Sofőr register HTTP ${regC.status}: ${JSON.stringify(regC.body)}`);
    const carrier = { id: regC.body.user.id, token: regC.body.token };
    createdUsers.push(carrier.id);

    await pool.query(
      `UPDATE users SET identity_kyc_status='verified', driver_kyc_status='verified',
              driver_terms_accepted_at=NOW(), email_verified=TRUE, phone='+36201111111'
        WHERE id = ANY($1)`,
      [[shipper.id, carrier.id]],
    );
    log('1) Feladó + sofőr létrehozva (prod), KYC verified');

    // 2. Elfogadott teszt-fuvar — a CÍMZETT a megadott szám
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { rows: jr } = await pool.query(
      `INSERT INTO jobs (shipper_id, carrier_id, title, description,
          pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
          suggested_price_huf, accepted_price_huf, status,
          delivery_code, sender_delivery_code, tracking_token, recipient_name, recipient_phone,
          connection_fee_huf)
       VALUES ($1,$2,'TESZT SMS fuvar — törlésre kerül','x','Budapest',47.5,19.0,'Szeged',46.2,20.1,
          15000,15000,'accepted',$3,'999888',encode(gen_random_bytes(16),'hex'),'SMS Teszt',$4,500)
       RETURNING id`,
      [shipper.id, carrier.id, code, phone],
    );
    const jobId = jr[0].id;
    createdJobs.push(jobId);
    log(`2) Teszt-fuvar létrehozva (kód: ${code}, címzett: ${phone.slice(0, 6)}•••)`);

    // 3. Díj-fizetés (stub) — enélkül a felvétel tiltott (paid_at guard)
    const pay = await api(`/jobs/${jobId}/pay`, { method: 'POST', token: shipper.token, body: { consent: true } });
    if (pay.status !== 200) throw new Error(`/pay HTTP ${pay.status}: ${JSON.stringify(pay.body)}`);
    const conf = await api(`/jobs/${jobId}/confirm-payment`, { method: 'POST', token: shipper.token, body: {} });
    if (conf.status !== 200) throw new Error(`/confirm-payment HTTP ${conf.status}: ${JSON.stringify(conf.body)}`);
    log('3) Kapcsolatfelvételi díj fizetve (stub) → felvétel engedélyezve');

    // 4. FELVÉTELI FOTÓ a sofőrrel → a szerver ITT küldi az éles SMS-t
    const form = new FormData();
    form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'pickup.png');
    form.append('kind', 'pickup');
    const up = await fetch(`${API}/jobs/${jobId}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${carrier.token}` },
      body: form,
    });
    const upBody = await up.json().catch(() => ({}));
    if (up.status !== 201) throw new Error(`Fotó-feltöltés HTTP ${up.status}: ${JSON.stringify(upBody)}`);
    log('4) Felvételi fotó feltöltve → a szerver kiküldte az SMS-t 📱');

    // 5. Státusz-ellenőrzés + kis várakozás, hogy a fire-and-forget SMS elmenjen
    const { rows: st } = await pool.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
    if (st[0].status !== 'in_progress') throw new Error(`Várt in_progress, kapott: ${st[0].status}`);
    log(`5) Fuvar-státusz: in_progress ✓ — várható SMS: "GoFuvar: uton a csomagod! Atveteli kod: ${code}. Sofor: Teszt Sofor Sandor, tel: +36201111111. ..."`);
    await new Promise((r) => setTimeout(r, 8000));

    console.log('\n════════ ✅ A LÁNC LEFUTOTT — NÉZD A TELEFONOD! ════════');
    console.log('   (Ha 1-2 percen belül nincs SMS: SeeMe egyenleg/kulcs — Railway log: [sms] sor)\n');
  } catch (e) {
    ok = false;
    console.error('\n   ❌ HIBA:', e.message, '\n');
  } finally {
    await cleanup();
    await pool.end();
    process.exit(ok ? 0 : 1);
  }
})();
