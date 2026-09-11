// Migrációk futtatása — NYILVÁNTARTÁSSAL (2026-09-11, Codex-audit P0-01).
//
// A futtató 2026-09-11-ig MINDEN fájlt MINDEN futásnál végrehajtott, arra
// építve, hogy „minden migráció idempotens". Ez a DDL-re igaz volt
// (IF NOT EXISTS), az ADATMÓDOSÍTÓ sorokra nem: a 034-es
// `UPDATE users SET email_verified = true WHERE email_verified = false`
// minden `npm run db:migrate`-nél igazolttá tette az AZÓTA regisztrált, még
// nem igazolt fiókokat is (az éles DB-ben 13 ilyen fiók nyoma látszik), a
// 061-es pedig a friss HMAC-lenyomatokat is nullázta. Az e-mail-kapu a
// KYC-mentes feladói modell egyetlen kapuja — ezt nem lehet a memóriára bízni.
//
// Mostantól: `schema_migrations` tábla tartja, melyik fájl futott már le;
// egy fájl EGYSZER fut. A fájlok továbbra is idempotensek maradnak (a
// friss teszt-DB és a lokális fejlesztés miatt), de a nyilvántartás miatt
// egy jövőbeli, feltétel nélküli UPDATE sem tud másodszor lefutni.
// Advisory lock véd a párhuzamos futtatás ellen.
//
// SZABÁLY: már lefuttatott fájlt NEM szerkesztünk — új változás = új fájl.
// Őr: tests/migracio-ujrafuttatas-or.test.js (kétszer futtat, és a két
// DML-migrációt friss sorokon méri).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const ADVISORY_LOCK_KEY = 7241001;

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

/**
 * Lefuttatja a még nem alkalmazott migrációkat.
 * @param {import('pg').Client} client — EGY dedikált kapcsolat (az advisory
 *   lock session-szintű; poolon át a lock és az unlock más sessionre esne).
 * @returns {Promise<{applied:number, skipped:number, total:number}>}
 */
async function runMigrations(client, { log = console.log } = {}) {
  const files = migrationFiles();
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const done = new Set(rows.map((r) => r.filename));
    let applied = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      log(`[migrate] Futtatom: ${f}`);
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [f],
      );
      applied += 1;
    }
    return { applied, skipped: files.length - applied, total: files.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}

module.exports = { runMigrations, migrationFiles, MIGRATIONS_DIR };

if (require.main === module) {
  (async () => {
    const useSsl = process.env.PGSSL === 'require' || /sslmode=require/.test(process.env.DATABASE_URL || '');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await client.connect();
      const r = await runMigrations(client);
      console.log(`[migrate] Kész: ${r.applied} új, ${r.skipped} már lefutott (${r.total} fájl).`);
    } catch (err) {
      console.error('[migrate] Hiba:', err);
      process.exit(1);
    } finally {
      await client.end();
    }
  })();
}
