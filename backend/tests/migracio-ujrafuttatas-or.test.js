// =====================================================================
//  MIGRÁCIÓ-ŐR: kétszeri futtatás nem módosít adatot (2026-09-11)
//
//  Codex-audit P0-01: a futtató minden migrációt minden futásnál újra
//  végrehajtott, és a 034-es feltétel nélküli UPDATE-je MINDEN nem igazolt
//  fiókot igazolttá tett — az azóta regisztráltakat is (az éles DB-ben 13
//  ilyen fiók nyoma látszott). A 061-es ugyanígy nullázta a friss
//  HMAC-lenyomatokat. Az e-mail-kapu a KYC-mentes feladói modell EGYETLEN
//  kapuja, tehát ez nem kozmetika.
//
//  Három védelem, három mérés:
//   (1) a két DML-migráció SQL-je friss sorokon lefuttatva nem nyúl hozzájuk;
//   (2) a futtató nyilvántart (schema_migrations): a második futás 0 fájlt
//       futtat — külön adatbázisban, hogy a DDL a párhuzamos teszteket ne zavarja;
//   (3) statikus: egyetlen migráció sem tartalmaz WHERE nélküli UPDATE/DELETE-et.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

const { Client } = require('pg');
const { db, createUser } = require('./helpers');
const { runMigrations, MIGRATIONS_DIR } = require('../scripts/migrate');

describe('Migrációk újrafuttatása', () => {
  it('a 034-es NEM igazolja az azóta regisztrált, nem igazolt fiókot', async () => {
    const u = await createUser({ emailVerified: false });
    await db.query(readFileSync(path.join(MIGRATIONS_DIR, '034_email_verification_password_reset.sql'), 'utf8'));
    const { rows } = await db.query('SELECT email_verified FROM users WHERE id = $1', [u.id]);
    expect(
      rows[0].email_verified,
      'A 034-es migráció újrafuttatása igazolttá tett egy friss, nem igazolt fiókot — '
      + 'az e-mail-kapu (a feladói modell egyetlen kapuja) egy db:migrate-tel kinyílik.',
    ).toBe(false);
  });

  it('a 061-es NEM törli az új (HMAC-elt) törölt-fiók lenyomatot', async () => {
    const { rows: ins } = await db.query(
      `INSERT INTO deleted_accounts (original_user_id, email_hash, reason, hash_algo)
       VALUES (gen_random_uuid(), 'hmac-teszt-lenyomat', 'teszt', 'hmac-sha256') RETURNING id`,
    );
    await db.query(readFileSync(path.join(MIGRATIONS_DIR, '061_torolt_fiok_lenyomat.sql'), 'utf8'));
    const { rows } = await db.query('SELECT email_hash FROM deleted_accounts WHERE id = $1', [ins[0].id]);
    expect(rows[0].email_hash, 'a 061-es újrafuttatása a HMAC-lenyomatot is nullázta').toBe('hmac-teszt-lenyomat');
  });

  it('a futtató nyilvántart: a második futás semmit nem futtat újra, az adat érintetlen', async () => {
    const url = new URL(process.env.DATABASE_URL);
    const dbName = `migr_or_${Date.now()}`;
    await db.query(`CREATE DATABASE ${dbName}`);
    url.pathname = `/${dbName}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await c.query(readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
      const r1 = await runMigrations(c, { log: () => {} });
      expect(r1.applied, 'friss DB-n minden migrációnak le kell futnia').toBe(r1.total);
      expect(r1.total).toBeGreaterThan(70);

      await c.query(
        `INSERT INTO users (role, email, password_hash, full_name, phone, email_verified)
         VALUES ('shipper', 'migr-or@example.com', 'x', 'Migr Őr', '+36201234567', false)`,
      );
      const r2 = await runMigrations(c, { log: () => {} });
      expect(r2.applied, 'a második futás újrafuttatott migrációt — nincs nyilvántartás').toBe(0);
      expect(r2.skipped).toBe(r1.total);
      const { rows } = await c.query(`SELECT email_verified FROM users WHERE email = 'migr-or@example.com'`);
      expect(rows[0].email_verified).toBe(false);
    } finally {
      await c.end();
      await db.query(`DROP DATABASE ${dbName}`);
    }
  });

  it('statikus őr: nincs WHERE nélküli UPDATE/DELETE a migrációkban', () => {
    const hibak = [];
    for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
        .replace(/--[^\n]*/g, '');
      for (const stmt of sql.split(';')) {
        const s = stmt.trim();
        if (/^(UPDATE|DELETE\s+FROM)\s/i.test(s) && !/\bWHERE\b/i.test(s)) {
          hibak.push(`${f}: ${s.slice(0, 80).replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(
      hibak,
      'WHERE nélküli adatmódosítás a migrációban — a nyilvántartás egyszer futtatja, de '
      + 'friss DB-n (teszt, lokális) és kézi újrafuttatásnál akkor is minden sort érint:\n'
      + hibak.join('\n'),
    ).toEqual([]);
  });
});
