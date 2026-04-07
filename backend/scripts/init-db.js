// Betölti a schema.sql tartalmát a DATABASE_URL-ben megadott PostgreSQL-be.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
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
