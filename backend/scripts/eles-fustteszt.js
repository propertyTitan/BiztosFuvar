/* eslint-disable no-console */
// ÉLES füstteszt — a teljes kápé-modell flow végigjátszása a prod API-n
// (api.gofuvar.hu) jelölt tesztadatokkal, a végén teljes takarítással a
// prod Neon DB-ben (backend/.env DATABASE_URL).
//
// Futtatás:  node scripts/eles-fustteszt.js
//
// A CLAUDE.md 9-es pontja szerinti éles-verifikációs minta. A script
// SOHA nem nyúl idegen (nem általa létrehozott) adathoz.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const API = 'https://api.gofuvar.hu';
const RUN_ID = `fust-${Date.now()}`;

// --- prod DB connstring a backend/.env-ből ---
const envRaw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const DATABASE_URL = (envRaw.match(/^DATABASE_URL=(.+)$/m) || [])[1];
if (!DATABASE_URL) { console.error('Nincs DATABASE_URL a backend/.env-ben'); process.exit(1); }

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api(method, pathName, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${API}${pathName}`, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* üres body */ }
  return { status: res.status, json };
}

function photoForm(kind, code) {
  const form = new FormData();
  form.append('file', new Blob([TINY_PNG], { type: 'image/png' }), 'fustteszt.png');
  form.append('kind', kind);
  if (code) form.append('delivery_code', code);
  return form;
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  const created = { userIds: [], jobIds: [], routeIds: [], bookingIds: [] };

  try {
    // ===== 0. Regisztráció (valós prod API) =====
    const shipperEmail = `${RUN_ID}-felado@teszt.gofuvar.hu`;
    const carrierEmail = `${RUN_ID}-sofor@teszt.gofuvar.hu`;
    const reg1 = await api('POST', '/auth/register', {
      body: { email: shipperEmail, password: 'FustTeszt123!', full_name: '[TESZT] Füst Feladó', phone: '+36 20 111 2233' },
    });
    const reg2 = await api('POST', '/auth/register', {
      body: { email: carrierEmail, password: 'FustTeszt123!', full_name: '[TESZT] Füst Szállító', phone: '+36 20 444 5566' },
    });
    check('Regisztráció (feladó + szállító)', reg1.status === 201 && reg2.status === 201,
      `${reg1.status}/${reg2.status}`);
    const shipper = { token: reg1.json?.token, id: reg1.json?.user?.id };
    const carrier = { token: reg2.json?.token, id: reg2.json?.user?.id };
    created.userIds.push(shipper.id, carrier.id);


    // KYC verified közvetlen DB-vel (a Gemini-s feltöltést nem játsszuk el élesben)
    await db.query(
      `UPDATE users SET identity_kyc_status='verified', driver_kyc_status='verified'
        WHERE id = ANY($1::uuid[])`,
      [created.userIds],
    );

    // ===== 1. LICITES FUVAR flow =====
    const jobRes = await api('POST', '/jobs', {
      token: shipper.token,
      body: {
        title: `[TESZT ${RUN_ID}] Éles füstteszt — törlésre kerül`,
        description: 'Automatikus éles füstteszt, kérjük figyelmen kívül hagyni.',
        pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.5104, pickup_lng: 19.0621,
        dropoff_address: 'Szeged, Kossuth Lajos sugárút 1.', dropoff_lat: 46.2546, dropoff_lng: 20.1443,
        weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
        suggested_price_huf: 12000,
      },
    });
    check('Fuvar feladása', jobRes.status === 201, `${jobRes.status}`);
    const jobId = jobRes.json?.id;
    const deliveryCode = jobRes.json?.delivery_code; // a létrehozási válaszban jár a feladónak
    created.jobIds.push(jobId);

    const bidRes = await api('POST', `/jobs/${jobId}/bids`, {
      token: carrier.token,
      body: { amount_huf: 12000, return_policy: 'included' },
    });
    check('Licit (szállító)', bidRes.status === 201, `${bidRes.status}`);
    const bidId = bidRes.json?.id;

    const accept = await api('POST', `/bids/${bidId}/accept`, { token: shipper.token, body: {} });
    check('Licit elfogadása — díj 500 Ft (12e Ft sáv)',
      accept.status === 200 && accept.json?.connection_fee_huf === 500,
      `${accept.status}, fee=${accept.json?.connection_fee_huf}`);

    // Kontakt MÉG nem látszik
    const jobBefore = await api('GET', `/jobs/${jobId}`, { token: shipper.token });
    check('Kontakt fizetés ELŐTT rejtve', !jobBefore.json?.contact && !jobBefore.json?.paid_at, '');

    // Consent nélkül nem indul fizetés
    const noConsent = await api('POST', `/jobs/${jobId}/pay`, { token: shipper.token, body: {} });
    check('Fizetés consent nélkül → 400 CONSENT_REQUIRED',
      noConsent.status === 400 && noConsent.json?.code === 'CONSENT_REQUIRED', `${noConsent.status}`);

    const pay = await api('POST', `/jobs/${jobId}/pay`, { token: shipper.token, body: { consent: true } });
    check('Díj-fizetés indítása (stub gateway)', pay.status === 200 && pay.json?.fee_huf === 500,
      `${pay.status}, gateway=${pay.json?.gateway_url}`);

    const confirm = await api('POST', `/jobs/${jobId}/confirm-payment`, { token: shipper.token, body: {} });
    check('Fizetés nyugtázása (stub mód)', confirm.status === 200, `${confirm.status}`);

    const jobAfterS = await api('GET', `/jobs/${jobId}`, { token: shipper.token });
    const jobAfterC = await api('GET', `/jobs/${jobId}`, { token: carrier.token });
    check('Kontakt-felfedés a díj UTÁN (mindkét fél)',
      jobAfterS.json?.contact?.phone === '+36 20 444 5566'
      && jobAfterC.json?.contact?.phone === '+36 20 111 2233',
      `feladó látja: ${jobAfterS.json?.contact?.phone}, szállító látja: ${jobAfterC.json?.contact?.phone}`);
    check('Címzetti kód a létrehozási válaszban + vész-kód a GET-ben',
      /^\d{6}$/.test(deliveryCode || '') && /^\d{6}$/.test(jobAfterS.json?.sender_delivery_code || ''), '');

    const pickup = await api('POST', `/jobs/${jobId}/photos`, { token: carrier.token, form: photoForm('pickup') });
    check('Felvétel (pickup fotó) → in_progress', pickup.status === 201, `${pickup.status}`);

    const badDrop = await api('POST', `/jobs/${jobId}/photos`, {
      token: carrier.token, form: photoForm('dropoff', '000000'),
    });
    check('Rossz kóddal a lezárás tiltott (403)', badDrop.status === 403, `${badDrop.status}`);

    const drop = await api('POST', `/jobs/${jobId}/photos`, {
      token: carrier.token, form: photoForm('dropoff', deliveryCode),
    });
    const jobFinal = await api('GET', `/jobs/${jobId}`, { token: shipper.token });
    check('Kézbesítés helyes kóddal → delivered',
      drop.status === 201 && jobFinal.json?.status === 'delivered',
      `${drop.status}, státusz=${jobFinal.json?.status}`);

    // ===== 2. FIX ÁRAS FOGLALÁS flow (BUG-041) =====
    const routeRes = await api('POST', '/carrier-routes', {
      token: carrier.token,
      body: {
        title: `[TESZT ${RUN_ID}] Füstteszt útvonal — törlésre kerül`,
        departure_at: new Date(Date.now() + 86400000).toISOString(),
        waypoints: [
          { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
          { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
        ],
        prices: [{ size: 'M', price_huf: 12000 }],
        status: 'open',
      },
    });
    check('Útvonal-hirdetés (szállító)', routeRes.status === 201, `${routeRes.status}`);
    const routeId = routeRes.json?.id;
    created.routeIds.push(routeId);

    const bookRes = await api('POST', `/carrier-routes/${routeId}/bookings`, {
      token: shipper.token,
      body: {
        length_cm: 40, width_cm: 30, height_cm: 20, weight_kg: 5,
        pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.5104, pickup_lng: 19.0621,
        dropoff_address: 'Szeged, Kossuth Lajos sugárút 1.', dropoff_lat: 46.2546, dropoff_lng: 20.1443,
      },
    });
    check('Foglalás (feladó)', bookRes.status === 201, `${bookRes.status}`);
    const bookingId = bookRes.json?.id;
    created.bookingIds.push(bookingId);

    const bConfirm = await api('POST', `/route-bookings/${bookingId}/confirm`, { token: carrier.token, body: {} });
    check('Szállítói megerősítés (díj-fizetés indul)', bConfirm.status === 200, `${bConfirm.status}`);

    const bPay = await api('POST', `/route-bookings/${bookingId}/pay`, { token: shipper.token, body: { consent: true } });
    const bConfirmPay = await api('POST', `/route-bookings/${bookingId}/confirm-payment`, { token: shipper.token, body: {} });
    check('Foglalás díj-fizetés + nyugtázás', bPay.status === 200 && bConfirmPay.status === 200,
      `${bPay.status}/${bConfirmPay.status}`);

    const { rows: bRows } = await db.query('SELECT delivery_code FROM route_bookings WHERE id = $1', [bookingId]);
    const bCode = bRows[0]?.delivery_code;

    const bPickup = await api('POST', `/route-bookings/${bookingId}/photos`, {
      token: carrier.token, form: photoForm('pickup'),
    });
    check('BUG-041: foglalás felvétel → in_progress', bPickup.status === 201, `${bPickup.status}`);

    const bDrop = await api('POST', `/route-bookings/${bookingId}/photos`, {
      token: carrier.token, form: photoForm('dropoff', bCode),
    });
    const { rows: bFinal } = await db.query('SELECT status, delivered_at FROM route_bookings WHERE id = $1', [bookingId]);
    check('BUG-041: foglalás kézbesítés → delivered',
      bDrop.status === 201 && bFinal[0]?.status === 'delivered' && !!bFinal[0]?.delivered_at,
      `${bDrop.status}, státusz=${bFinal[0]?.status}`);

    // ===== 3. Szállító-csere (reopen) gyors ellenőrzés egy 2. fuvaron =====
    const job2 = await api('POST', '/jobs', {
      token: shipper.token,
      body: {
        title: `[TESZT ${RUN_ID}] Reopen füstteszt — törlésre kerül`,
        pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.5104, pickup_lng: 19.0621,
        dropoff_address: 'Szeged, Kossuth Lajos sugárút 1.', dropoff_lat: 46.2546, dropoff_lng: 20.1443,
        weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
        suggested_price_huf: 60000,
      },
    });
    created.jobIds.push(job2.json?.id);
    const bid2 = await api('POST', `/jobs/${job2.json?.id}/bids`, {
      token: carrier.token, body: { amount_huf: 60000, return_policy: 'included' },
    });
    const accept2 = await api('POST', `/bids/${bid2.json?.id}/accept`, { token: shipper.token, body: {} });
    check('2. fuvar: 60e Ft → 1000 Ft-os felső díjsáv (2026-07-15 árazás)', accept2.json?.connection_fee_huf === 1000,
      `fee=${accept2.json?.connection_fee_huf}`);
    const reopen = await api('POST', `/jobs/${job2.json?.id}/reopen`, { token: shipper.token, body: { reason: 'füstteszt' } });
    const job2After = await api('GET', `/jobs/${job2.json?.id}`, { token: shipper.token });
    check('Szállító-csere (reopen) → vissza bidding-re',
      reopen.status === 200 && job2After.json?.status === 'bidding', `${reopen.status}, ${job2After.json?.status}`);
  } finally {
    // ===== TAKARÍTÁS — csak a script által létrehozott sorok =====
    console.log('\n--- Takarítás a prod DB-ben ---');
    const ids = created.userIds.filter(Boolean);
    if (ids.length) {
      // Nem-cascade / bizonytalan FK-jú táblák előbb, azonosító alapján
      await db.query(`DELETE FROM payment_events WHERE job_id = ANY($1::uuid[]) OR booking_id = ANY($2::uuid[])`,
        [created.jobIds.filter(Boolean), created.bookingIds.filter(Boolean)]).catch(() => {});
      await db.query(`DELETE FROM invoices WHERE job_id = ANY($1::uuid[]) OR booking_id = ANY($2::uuid[])`,
        [created.jobIds.filter(Boolean), created.bookingIds.filter(Boolean)]).catch(() => {});
      const del = await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[]) AND email LIKE '%@teszt.gofuvar.hu' RETURNING email`, [ids]);
      console.log(`Törölve: ${del.rows.map((r) => r.email).join(', ')} (+ cascade: fuvarok, licitek, útvonal, foglalás, fotók, díj-sorok)`);
      const { rows: leftover } = await db.query(
        `SELECT COUNT(*)::int AS c FROM jobs WHERE id = ANY($1::uuid[])`, [created.jobIds.filter(Boolean)],
      );
      console.log(`Maradék teszt-fuvar a DB-ben: ${leftover[0].c} (0 az elvárt)`);
    }
    await db.end();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== EREDMÉNY: ${results.length - failed.length}/${results.length} PASS =====`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error('FATÁLIS:', e); process.exit(1); });
