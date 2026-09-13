// =====================================================================
//  BOOT-IDEJŰ MIGRÁCIÓ-ELLENŐRZÉS (2026-09-13, teljes audit D4)
//
//  A Railway a merge-re automatikusan deployol, a migráció viszont KÉZI
//  (laptopról, `npm run db:migrate`). A két lépés közti ablakban a kód olyan
//  oszlopra hivatkozik, ami még nincs — és a tünet NÉMA volt (a napi körök
//  elhasaltak, riasztás nélkül). Ez a kör csak OLVAS: a `schema_migrations`
//  tábla sorait a `db/migrations/*.sql` fájllistához méri; eltérésnél hangos
//  log + Sentry error. Migrálni NEM migrál (az a laptop dolga, a pooler
//  session-szintű advisory lockja miatt).
// =====================================================================
const { migrationFiles } = require('../../scripts/migrate');

async function ellenorizMigraciok(db, { log = console } = {}) {
  let rows;
  try {
    ({ rows } = await db.query('SELECT filename FROM schema_migrations'));
  } catch (err) {
    log.warn('[migracio-ellenorzes] a schema_migrations nem olvasható:', err && err.message);
    return { ok: null, hianyzo: [] };
  }
  const lefutott = new Set(rows.map((r) => r.filename));
  const hianyzo = migrationFiles().filter((f) => !lefutott.has(f));
  if (hianyzo.length > 0) {
    const uzenet = `[migracio-ellenorzes] ${hianyzo.length} migráció NEM futott le a DB-n: ${hianyzo.join(', ')} — `
      + 'a kód olyan sémára hivatkozhat, ami még nincs (npm run db:migrate)';
    log.error(uzenet);
    try {
      require('@sentry/node').captureMessage(uzenet, { level: 'error', tags: { csatorna: 'migracio' }, extra: { hianyzo } });
    } catch { /* nincs Sentry */ }
  }
  return { ok: hianyzo.length === 0, hianyzo };
}

module.exports = { ellenorizMigraciok };
