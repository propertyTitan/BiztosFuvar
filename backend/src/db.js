// PostgreSQL connection pool.
const { Pool } = require('pg');

// Prod-ban (Neon / Supabase / Railway) SSL kötelező. A PGSSL=require env
// bekapcsolja — lokálban marad a sima connection string.
const useSsl = process.env.PGSSL === 'require' || /sslmode=require/.test(process.env.DATABASE_URL || '');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

pool.on('error', (err) => {
  console.error('[db] Váratlan pool hiba:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
