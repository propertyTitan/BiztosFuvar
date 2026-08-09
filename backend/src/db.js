// PostgreSQL connection pool.
const { Pool } = require('pg');

// Prod-ban (Neon / Supabase / Railway) SSL kötelező. A PGSSL=require env
// bekapcsolja — lokálban marad a sima connection string.
const useSsl = process.env.PGSSL === 'require' || /sslmode=require/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  // Egyidejű DB-kapcsolatok. A default 10 volt a fő szűk keresztmetszet a
  // DB-kötött végpontokon (a k6 plafon-teszt mérte, 2026-08-09). A prod a
  // Neon PgBouncer-poolerén csatlakozik (host: …-pooler…), a Postgres
  // max_connections=901 → a 30 bőven biztonságos (~3× kapacitás), az idle
  // kapcsolatokat a pg 10 mp után lezárja. Env-ből tovább emelhető, ha kell.
  max: Number(process.env.DB_POOL_MAX) || 30,
});

pool.on('error', (err) => {
  console.error('[db] Váratlan pool hiba:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
