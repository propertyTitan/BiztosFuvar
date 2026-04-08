// Lefuttatja sorrendben a `db/migrations/*.sql` fájlokat.
// Idempotens – minden migrációs fájl tartalmaz IF NOT EXISTS / ADD COLUMN IF NOT EXISTS
// típusú feltételes SQL-t, így nyugodtan újrafuttatható.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const dir = path.join(__dirname, '..', 'db', 'migrations');
  if (!fs.existsSync(dir)) {
    console.log('[migrate] Nincs migrations mappa, kihagyva.');
    return;
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('[migrate] Nincs futtatandó migráció.');
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8');
      console.log(`[migrate] Futtatom: ${f}`);
      await client.query(sql);
    }
    console.log(`[migrate] Kész (${files.length} migráció).`);
  } catch (err) {
    console.error('[migrate] Hiba:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
