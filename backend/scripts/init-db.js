// Betölti a schema.sql tartalmát a DATABASE_URL-ben megadott PostgreSQL-be.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const useSsl = process.env.PGSSL === 'require' || /sslmode=require/.test(process.env.DATABASE_URL || '');
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.query(sql);
    console.log('[db] Séma sikeresen betöltve.');
  } catch (err) {
    console.error('[db] Hiba a séma betöltésekor:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
