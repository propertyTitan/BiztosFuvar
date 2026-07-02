// Közös beágyazott-Postgres indító — a backend unit tesztek (vitest) ÉS a
// web Playwright E2E tesztek is ezt használják, csak más porton.
//
// Az embedded-postgres letölti a platform-natív Postgres binárist
// (devDependency), eldobható adatkönyvtárral fut, majd nyomtalanul leáll.
// A séma az éles úton töltődik: db/schema.sql + db/migrations/*.sql sorrendben.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function loadSchema(dbUrl) {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await client.query(schemaSql);

    const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await client.query(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
    }
    console.log(`[teszt-db] séma + ${files.length} migráció betöltve`);
  } finally {
    await client.end();
  }
}

/**
 * Elindít egy eldobható Postgrest, betölti a sémát, és visszaadja a
 * connection stringet + a stop() függvényt.
 */
async function startTestPostgres({ port, dataDir }) {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  // Korábbi, félbemaradt futás adatkönyvtára ne zavarjon be
  fs.rmSync(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'gofuvar',
    password: 'gofuvar',
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('gofuvar_test');

  const databaseUrl = `postgres://gofuvar:gofuvar@127.0.0.1:${port}/gofuvar_test`;
  await loadSchema(databaseUrl);

  return {
    databaseUrl,
    async stop() {
      await pg.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startTestPostgres };
