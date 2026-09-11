// =====================================================================
//  A RETENCIÓS NAPLÓ NEM LEHET HAMISAN ZÖLD (2026-09-11, Codex-audit P1-09)
//
//  A napi futás `ok` mezője csak akkor mond igazat, ha a körök TOVÁBBADJÁK a
//  hibájukat. Ez a teszt egy „nyelő" körnek számító lépés (értesítés-purge)
//  SQL-jét hasaltatja el DB-szinten, és azt méri, hogy a retention_runs
//  ok=false-t és a kör nevét rögzíti — nem 0 érintett sorral „sikert".
// =====================================================================
import { describe, it, expect, afterEach, vi } from 'vitest';

const { db } = require('./helpers');
const retention = require('../src/services/retention');
const dbModul = require('../src/db');

afterEach(() => { vi.restoreAllMocks(); });

describe('runDailyRetention DB-hiba mellett', () => {
  it('ok=false és a kör neve a hibák közt (nem néma 0)', async () => {
    // A kör első lekérdezésének táblanevét a forrásból olvassuk, hogy a
    // minta ne égjen be (ha a kör SQL-je változik, az őr vele mozog).
    const forras = retention.purgeOldNotifications.toString();
    const tabla = (forras.match(/FROM\s+([a-z_]+)/i) || [])[1];
    expect(tabla, 'nem találom a purgeOldNotifications táblanevét').toBeTruthy();
    const minta = new RegExp(`FROM\\s+${tabla}\\b`, 'i');

    const eredeti = dbModul.query.bind(dbModul);
    let talalat = 0;
    vi.spyOn(dbModul, 'query').mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && minta.test(sql)) { talalat += 1; throw new Error('szimulált DB-hiba'); }
      return eredeti(sql, params);
    });

    await retention.runDailyRetention();
    expect(talalat, 'az injekció nem futott le — a teszt hamis zöld lenne').toBeGreaterThan(0);

    const { rows } = await eredeti('SELECT ok, hibak FROM retention_runs ORDER BY finished_at DESC LIMIT 1');
    expect(rows[0].ok, 'a napi futás ok=true-t naplózott egy elszállt kör mellett').toBe(false);
    expect(Object.keys(rows[0].hibak)).toContain('purgeOldNotifications');
  });
});
