// Magyar mintaadatok – fejlesztéshez és bemutatóhoz.
// Felhasználók: 2 feladó, 3 sofőr, 1 admin.
// Fuvarok: Budapest ↔ Debrecen ↔ Szeged útvonalak (valós GPS koordináták).
//
// Futtatás:
//   node scripts/seed.js          → újraseed (törli a meglévő mintaadatokat email szerint)
//   node scripts/seed.js --keep   → csak hozzáad

require('dotenv').config();
const crypto = require('crypto');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

// Magyar városok GPS koordinátái (központok)
const VAROSOK = {
  budapest:  { name: 'Budapest, Deák Ferenc tér 1.', lat: 47.4979, lng: 19.0540 },
  debrecen:  { name: 'Debrecen, Piac utca 20.',      lat: 47.5316, lng: 21.6273 },
  szeged:    { name: 'Szeged, Széchenyi tér 10.',    lat: 46.2530, lng: 20.1414 },
  miskolc:   { name: 'Miskolc, Városház tér 8.',     lat: 48.1035, lng: 20.7784 },
  pecs:      { name: 'Pécs, Széchenyi tér 1.',       lat: 46.0727, lng: 18.2323 },
  gyor:      { name: 'Győr, Városház tér 1.',        lat: 47.6849, lng: 17.6354 },
};

const FELHASZNALOK = [
  // feladók
  { email: 'kovacs.peter@example.hu', full_name: 'Kovács Péter', role: 'shipper', phone: '+36301112233' },
  { email: 'nagy.eszter@example.hu',  full_name: 'Nagy Eszter',  role: 'shipper', phone: '+36302223344' },
  // sofőrök
  { email: 'szabo.janos@example.hu',  full_name: 'Szabó János',  role: 'carrier', phone: '+36303334455',
    vehicle_type: 'kisteherautó (3,5 t)', vehicle_plate: 'ABC-123', is_verified: true },
  { email: 'toth.gabor@example.hu',   full_name: 'Tóth Gábor',   role: 'carrier', phone: '+36304445566',
    vehicle_type: 'kombi', vehicle_plate: 'DEF-456', is_verified: true },
  { email: 'horvath.zoltan@example.hu', full_name: 'Horváth Zoltán', role: 'carrier', phone: '+36305556677',
    vehicle_type: 'platós teherautó', vehicle_plate: 'GHI-789', is_verified: false },
  // admin
  { email: 'admin@gofuvar.hu', full_name: 'GoFuvar Admin', role: 'admin', phone: '+36301000000' },
];

const FUVAROK = [
  {
    title: 'Költöztetés Budapestről Debrecenbe',
    description: '2 szobás lakás bútorai. 1 db kanapé, 1 db ágy, 4 db doboz, 1 db hűtő. Lift van mindkét helyen.',
    from: 'budapest', to: 'debrecen',
    weight_kg: 350, volume_m3: 8, suggested_price_huf: 65000,
  },
  {
    title: 'Raklapos áru Szegedről Budapestre',
    description: '3 db EUR raklap, élelmiszer (nem hűtős). Targonca van a felvételnél.',
    from: 'szeged', to: 'budapest',
    weight_kg: 600, volume_m3: 4, suggested_price_huf: 48000,
  },
  {
    title: 'Bútorszállítás Debrecen → Szeged',
    description: '1 db étkezőasztal, 6 db szék, 1 db tálalószekrény. Csomagolva.',
    from: 'debrecen', to: 'szeged',
    weight_kg: 180, volume_m3: 5, suggested_price_huf: 55000,
  },
  {
    title: 'Hűtőgép kiszállítás Budapest → Pécs',
    description: 'Új beépíthető hűtő, dobozolva. Földszint, kapun belül letenni.',
    from: 'budapest', to: 'pecs',
    weight_kg: 80, volume_m3: 1.2, suggested_price_huf: 32000,
  },
  {
    title: 'Iroda költöztetés Győr → Budapest',
    description: '4 db íróasztal, 6 db irodaszék, 10 db iratos doboz. Lift van.',
    from: 'gyor', to: 'budapest',
    weight_kg: 250, volume_m3: 6, suggested_price_huf: 38000,
  },
  {
    title: 'Építőanyag Miskolc → Debrecen',
    description: '20 zsák cement (50 kg/zsák), 5 db gipszkarton lap. Targonca nincs, kézi pakolás.',
    from: 'miskolc', to: 'debrecen',
    weight_kg: 1100, volume_m3: 1.5, suggested_price_huf: 42000,
  },
];

async function seed() {
  const keep = process.argv.includes('--keep');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!keep) {
      const emails = FELHASZNALOK.map((u) => u.email);
      await client.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]);
      console.log('[seed] Régi mintafelhasználók törölve.');
    }

    // 1) felhasználók
    const userIds = {};
    for (const u of FELHASZNALOK) {
      const { rows } = await client.query(
        `INSERT INTO users (role, email, password_hash, full_name, phone,
                            vehicle_type, vehicle_plate, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id, email`,
        [
          u.role, u.email, hashPassword('Jelszo123!'), u.full_name, u.phone,
          u.vehicle_type || null, u.vehicle_plate || null, u.is_verified || false,
        ],
      );
      userIds[u.email] = rows[0].id;
    }
    console.log(`[seed] ${FELHASZNALOK.length} felhasználó beszúrva (jelszó: Jelszo123!).`);

    // 2) fuvarok – körbeforgatva a két shipperen
    const shipperEmails = FELHASZNALOK.filter((u) => u.role === 'shipper').map((u) => u.email);
    let i = 0;
    for (const j of FUVAROK) {
      const from = VAROSOK[j.from], to = VAROSOK[j.to];
      const shipperId = userIds[shipperEmails[i % shipperEmails.length]];
      i++;
      // Haversine távolság km-ben
      const R = 6371;
      const dLat = (to.lat - from.lat) * Math.PI / 180;
      const dLng = (to.lng - from.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(from.lat * Math.PI / 180) * Math.cos(to.lat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      const distanceKm = +(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2);

      await client.query(
        `INSERT INTO jobs (
            shipper_id, title, description,
            pickup_address, pickup_lat, pickup_lng,
            dropoff_address, dropoff_lat, dropoff_lng,
            distance_km, weight_kg, volume_m3, suggested_price_huf,
            status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'bidding')`,
        [
          shipperId, j.title, j.description,
          from.name, from.lat, from.lng,
          to.name,   to.lat,   to.lng,
          distanceKm, j.weight_kg, j.volume_m3, j.suggested_price_huf,
        ],
      );
    }
    console.log(`[seed] ${FUVAROK.length} mintafuvar beszúrva.`);

    await client.query('COMMIT');
    console.log('[seed] Kész. Bejelentkezés bármelyik mintafelhasználóval, jelszó: Jelszo123!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Hiba:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
