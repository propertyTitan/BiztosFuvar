// Közös teszt-helperek: user/fuvar/escrow gyártás közvetlen SQL-lel, hogy a
// tesztek pontosan a kívánt állapotból induljanak, és csak a TESZTELT
// végpontot hívják API-n át.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Az env-setup.js már beállította a teszt-DATABASE_URL-t, így ezek a
// require-ok biztosan a teszt-DB-re kötnek.
const db = require('../src/db');
const { app } = require('../src/index');

let seq = 0;

/** Egyedi teszt-email — a users.email UNIQUE. */
function uniqueEmail(prefix = 'user') {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}@teszt.gofuvar.hu`;
}

/**
 * User létrehozása közvetlenül a DB-be, alapból átment KYC-vel
 * (identity + driver verified), hogy a middleware-ek ne állítsák meg.
 */
async function createUser({ role = 'shipper', kyc = 'verified', email } = {}) {
  const { rows } = await db.query(
    `INSERT INTO users (role, email, password_hash, full_name, phone,
                        identity_kyc_status, driver_kyc_status, driver_terms_accepted_at)
     VALUES ($1, $2, 'x', $3, '+36201234567', $4, $4,
             CASE WHEN $4 = 'verified' THEN NOW() ELSE NULL END)
     RETURNING id, role, email`,
    [role, email || uniqueEmail(role), `Teszt ${role}`, kyc],
  );
  const user = rows[0];
  user.token = jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
  return user;
}

const { calculateConnectionFee } = require('../src/services/connectionFee');

/**
 * Fuvar létrehozása a kívánt állapotban (készpénzes modell).
 *  - status: 'accepted' | 'in_progress' | ...
 *  - paid: true → a KAPCSOLATFELVÉTELI DÍJ fizetve: paid_at + fee_consent_at
 *    + 'released' díj-sor az escrow_transactions-ben (amount = díj, a
 *    fuvardíj kápéban megy, azt a platform nem könyveli)
 *  - carrierId: a kijelölt sofőr
 */
async function createJob({
  shipperId,
  carrierId = null,
  status = 'accepted',
  paid = false,
  priceHuf = 15000,
  deliveryCode = '111222',
  senderDeliveryCode = '333444',
  pickupAddress = 'Budapest, Teszt u. 1.',
  dropoffAddress = 'Szeged, Teszt tér 2.',
} = {}) {
  const trackingToken = crypto.randomBytes(16).toString('hex');
  const feeHuf = calculateConnectionFee(priceHuf);
  const { rows } = await db.query(
    `INSERT INTO jobs (
       shipper_id, carrier_id, title, description,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       suggested_price_huf, accepted_price_huf, status,
       delivery_code, sender_delivery_code, tracking_token,
       recipient_name, recipient_phone,
       connection_fee_huf,
       paid_at, fee_consent_at
     ) VALUES (
       $1, $2, 'Teszt fuvar', 'teszt',
       $10, 47.4979, 19.0402,
       $11, 46.2530, 20.1414,
       $3, $3, $4,
       $5, $6, $7,
       'Teszt Címzett', '+36301112233',
       $9,
       CASE WHEN $8 THEN NOW() ELSE NULL END,
       CASE WHEN $8 THEN NOW() ELSE NULL END
     ) RETURNING *`,
    [shipperId, carrierId, priceHuf, status, deliveryCode, senderDeliveryCode, trackingToken, paid, feeHuf,
     pickupAddress, dropoffAddress],
  );
  const job = rows[0];
  if (paid) {
    await db.query(
      `INSERT INTO escrow_transactions
         (job_id, amount_huf, status, barion_payment_id, carrier_share_huf, platform_share_huf, released_at)
       VALUES ($1, $2, 'released', $3, 0, $2, NOW())`,
      [job.id, feeHuf, `stub-${job.id}`],
    );
  }
  return job;
}

/**
 * Fix áras foglalás létrehozása a kívánt állapotban (útvonalastul).
 * A createJob tükre a foglalási ágra — a BUG-041 (foglalás-lezárás)
 * teszteléséhez.
 */
async function createBooking({
  shipperId,
  carrierId,
  status = 'confirmed',
  paid = false,
  priceHuf = 15000,
  deliveryCode = '111222',
} = {}) {
  const { rows: routeRows } = await db.query(
    `INSERT INTO carrier_routes (carrier_id, title, departure_at, status)
     VALUES ($1, 'Teszt útvonal', NOW() + INTERVAL '1 day', 'open')
     RETURNING id`,
    [carrierId],
  );
  const routeId = routeRows[0].id;
  const { rows } = await db.query(
    `INSERT INTO route_bookings (
       route_id, shipper_id, package_size, length_cm, width_cm, height_cm,
       weight_kg, pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       price_huf, delivery_code, status,
       recipient_name, recipient_phone,
       paid_at, fee_consent_at
     ) VALUES (
       $1, $2, 'M', 40, 30, 20,
       5, 'Budapest, Teszt u. 1.', 47.4979, 19.0402,
       'Szeged, Teszt tér 2.', 46.2530, 20.1414,
       $3, $4, $5,
       'Teszt Címzett', '+36301112233',
       CASE WHEN $6 THEN NOW() ELSE NULL END,
       CASE WHEN $6 THEN NOW() ELSE NULL END
     ) RETURNING *`,
    [routeId, shipperId, priceHuf, deliveryCode, status, paid],
  );
  return { booking: rows[0], routeId };
}

/** 1×1 pixeles érvényes PNG — a fotó-feltöltéses tesztekhez. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

module.exports = { db, app, createUser, createJob, createBooking, uniqueEmail, TINY_PNG };
