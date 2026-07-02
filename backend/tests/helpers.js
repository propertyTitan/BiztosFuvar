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
                        identity_kyc_status, driver_kyc_status)
     VALUES ($1, $2, 'x', $3, '+36201234567', $4, $4)
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

/**
 * Fuvar létrehozása a kívánt állapotban.
 *  - status: 'accepted' | 'in_progress' | ...
 *  - paid: true → paid_at = NOW() + 'held' escrow sor (stub Barion payment id-vel)
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
} = {}) {
  const trackingToken = crypto.randomBytes(16).toString('hex');
  const { rows } = await db.query(
    `INSERT INTO jobs (
       shipper_id, carrier_id, title, description,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       suggested_price_huf, accepted_price_huf, status,
       delivery_code, sender_delivery_code, tracking_token,
       recipient_name, recipient_phone,
       paid_at
     ) VALUES (
       $1, $2, 'Teszt fuvar', 'teszt',
       'Budapest, Teszt u. 1.', 47.4979, 19.0402,
       'Szeged, Teszt tér 2.', 46.2530, 20.1414,
       $3, $3, $4,
       $5, $6, $7,
       'Teszt Címzett', '+36301112233',
       CASE WHEN $8 THEN NOW() ELSE NULL END
     ) RETURNING *`,
    [shipperId, carrierId, priceHuf, status, deliveryCode, senderDeliveryCode, trackingToken, paid],
  );
  const job = rows[0];
  if (paid) {
    await db.query(
      `INSERT INTO escrow_transactions (job_id, amount_huf, status, barion_payment_id)
       VALUES ($1, $2, 'held', $3)`,
      [job.id, priceHuf, `stub-${job.id}`],
    );
  }
  return job;
}

/** 1×1 pixeles érvényes PNG — a fotó-feltöltéses tesztekhez. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

module.exports = { db, app, createUser, createJob, uniqueEmail, TINY_PNG };
