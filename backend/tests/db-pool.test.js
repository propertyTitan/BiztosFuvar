// =====================================================================
//  A DB connection pool mérete őrizve — csendes-konfig regresszió.
//
//  A default (10) volt a fő szűk keresztmetszet a DB-kötött végpontokon
//  (a k6 plafon-teszt mérte, 2026-08-09). 30-ra emeltük — a Neon
//  PgBouncer-pooler mögött (max_connections=901) ez biztonságos, és
//  ~3× kapacitást ad. Ha valaki visszaejtené a defaultra (a `max`
//  törlésével), ez a teszt pirosra vált — ugyanaz az elv, mint a
//  rate-limit konfig őrzésénél (a csendes garanciákat teszt védi).
// =====================================================================
import { describe, it, expect } from 'vitest';

const db = require('../src/db');

describe('DB connection pool', () => {
  it('a pool max mérete nagyobb a pg-alapértelmezett 10-nél (nem csúszott vissza)', () => {
    expect(db.pool.options.max).toBeGreaterThan(10);
  });
});
