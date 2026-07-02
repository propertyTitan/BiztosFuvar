// Beágyazott Postgres a tesztekhez — nincs szükség Dockerre vagy telepített
// Postgresre: az embedded-postgres csomag letölti a platform-natív binárist
// (devDependency), és egy eldobható adatbázist futtat a 54331-es porton.
//
// Séma: db/schema.sql + db/migrations/*.sql sorrendben — ugyanaz az út,
// mint élesben (npm run db:init + db:migrate), tehát a tesztek a valódi
// sémán futnak.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PG_PORT = 54331;
const DATA_DIR = path.join(__dirname, '.pg-data');
const DB_URL = `postgres://gofuvar:gofuvar@127.0.0.1:${PG_PORT}/gofuvar_test`;

let pgInstance;

async function loadSchema() {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await client.query(schemaSql);

    const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
    }
    console.log(`[teszt-db] séma + ${files.length} migráció betöltve`);
  } finally {
    await client.end();
  }
}

module.exports = async function globalSetup() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');

  // Korábbi, félbemaradt futás adatkönyvtára ne zavarjon be
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  pgInstance = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'gofuvar',
    password: 'gofuvar',
    port: PG_PORT,
    persistent: false,
  });

  await pgInstance.initialise();
  await pgInstance.start();
  await pgInstance.createDatabase('gofuvar_test');
  await loadSchema();

  return async function teardown() {
    await pgInstance.stop();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  };
};
