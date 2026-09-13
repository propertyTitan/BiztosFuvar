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
  // IDŐKERETEK (2026-09-13, teljes audit D4). A pg alapértelmezése
  // `connectionTimeoutMillis: 0` = ÖRÖKKÉ vár kapcsolatra, és a lekérdezésnek
  // sincs kliens-oldali plafonja: ha a Neon nem válaszol (pooler-telítődés,
  // hálózati partíció, alvásból nem ébred), MINDEN db.query a pool
  // várólistáján ül — a kérések „Szerverhiba"-ként jelennek meg a kliensnek,
  // de a szerveren tovább várnak, a memória nő, az ütemezett körök beragadnak.
  // A `query_timeout` KLIENS-oldali (a `SET statement_timeout` PgBouncer
  // tranzakciós módban nem megbízható). A hosszú retenciós UPDATE-ek
  // 30 mp alatt maradnak (LIMIT-elt kötegek).
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS) || 30000,
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 10000,
});

pool.on('error', (err) => {
  console.error('[db] Váratlan pool hiba:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
