// =====================================================================
//  ALVÓ FIÓKOK RETENCIÓJA (2026-08-12, user-döntés a 10. mérés F6-jára)
//
//  Egy fiók, ami évek óta nem lépett be, HATÁRIDŐ NÉLKÜL őrizte a nevet,
//  e-mailt, telefonszámot, rendszámot, avatart és bemutatkozást. A
//  tájékoztató „a fiókod élettartamáig"-ot ír — formálisan igaz volt, de az
//  „élettartam" a gyakorlatban végtelen (GDPR 5. cikk (1) e).
//
//  A szabály KÉT fázisú, mert az előzmény nélküli törlés elfogadhatatlan:
//  3 év tétlenség → figyelmeztető e-mail; +30 nap → törlés. Egyetlen
//  bejelentkezés visszaállítja az órát.
// =====================================================================
import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob,
} = require('./helpers');
const {
  purgeDormantAccounts, DORMANT_WARN_YEARS, DORMANT_DELETE_DAYS,
} = require('../src/services/retention');
const email = require('../src/services/email');

/** A fiók „elöregítése": ennyi éve nem lépett be. */
async function alvoFiok(evek, { warnedNapja = null } = {}) {
  const u = await createUser({ role: 'shipper' });
  await db.query(
    `UPDATE users
        SET last_login_at = NOW() - ($2 || ' years')::interval,
            created_at    = NOW() - ($2 || ' years')::interval,
            dormant_warned_at = CASE WHEN $3::int IS NULL THEN NULL
                                     ELSE NOW() - ($3 || ' days')::interval END
      WHERE id = $1`,
    [u.id, evek, warnedNapja],
  );
  return u;
}

const letezik = async (id) => (
  await db.query('SELECT 1 FROM users WHERE id = $1', [id])
).rows.length > 0;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(email, 'sendDormantAccountWarningEmail').mockResolvedValue({ id: 'stub' });
});

describe('Alvó fiók: figyelmeztetés, majd törlés', () => {
  it('3 évnél régebben inaktív fiók FIGYELMEZTETÉST kap (de még nem törlődik)', async () => {
    const u = await alvoFiok(DORMANT_WARN_YEARS + 1);

    await purgeDormantAccounts();

    expect(
      email.sendDormantAccountWarningEmail,
      'Az alvó fiók nem kapott figyelmeztetést — előzmény nélkül törölnénk.',
    ).toHaveBeenCalled();
    const { rows } = await db.query('SELECT dormant_warned_at FROM users WHERE id = $1', [u.id]);
    expect(rows[0].dormant_warned_at, 'a figyelmeztetés ténye nem rögzült').toBeTruthy();
    expect(await letezik(u.id), 'a fiók AZONNAL törlődött, figyelmeztetés után várakozás nélkül').toBe(true);
  });

  it('a figyelmeztetés után 30 nappal a fiók TÖRLŐDIK', async () => {
    const u = await alvoFiok(DORMANT_WARN_YEARS + 1, { warnedNapja: DORMANT_DELETE_DAYS + 1 });

    await purgeDormantAccounts();

    expect(
      await letezik(u.id),
      'Az alvó fiók a figyelmeztetés és a türelmi idő után sem törlődött — '
      + 'a személyes adat (név, e-mail, telefon, rendszám) határidő nélkül maradna.',
    ).toBe(false);
  });

  it('AKTÍV fiókot nem bánt', async () => {
    const u = await createUser({ role: 'shipper' });
    await purgeDormantAccounts();
    expect(email.sendDormantAccountWarningEmail).not.toHaveBeenCalled();
    expect(await letezik(u.id), 'egy friss fiókot töröltünk!').toBe(true);
  });

  it('a BEJELENTKEZÉS visszaállítja az órát', async () => {
    // A createUser 'x'-et tesz password_hash-nek, ezért valódi scrypt-hasht
    // írunk be — különben a /auth/login 401-et adna, és a teszt nem mérne semmit.
    const crypto = require('crypto');
    const jelszo = 'Jelszo12345';
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = `${salt}:${crypto.scryptSync(jelszo, salt, 64).toString('hex')}`;
    const u = await createUser({ role: 'shipper' });
    await db.query(
      `UPDATE users SET dormant_warned_at = NOW() - INTERVAL '10 days',
                        password_hash = $2
        WHERE id = $1`,
      [u.id, hash],
    );

    const res = await request(app).post('/auth/login').send({ email: u.email, password: jelszo });
    expect(res.status, 'a bejelentkezés nem sikerült — a teszt nem mér semmit').toBe(200);
    await new Promise((r) => { setTimeout(r, 150); });

    const { rows } = await db.query('SELECT dormant_warned_at FROM users WHERE id = $1', [u.id]);
    expect(
      rows[0].dormant_warned_at,
      'A bejelentkezés NEM nullázta a figyelmeztetés-jelzőt: az épp aktívvá vált '
      + 'felhasználó fiókját a következő kör akkor is törölné.',
    ).toBeNull();
  });

  it('AKTÍV+FIZETETT ügyletnél NEM töröl (más emberek ügyletei is odalennének)', async () => {
    const alvo = await alvoFiok(DORMANT_WARN_YEARS + 1, { warnedNapja: DORMANT_DELETE_DAYS + 1 });
    const szallito = await createUser({ role: 'carrier' });
    await createJob({
      shipperId: alvo.id, carrierId: szallito.id, status: 'in_progress', paid: true,
    });

    await purgeDormantAccounts();

    expect(
      await letezik(alvo.id),
      'Egy folyamatban lévő, KIFIZETETT ügylettel rendelkező fiókot töröltünk. '
      + 'A CASCADE ezzel MÁS emberek ügyleteit is megsemmisítené, és a vitás '
      + 'ügyletek 5 éves bizonyíték-zárolását is kiütné.',
    ).toBe(true);
  });

  it('e-mail-hiba esetén NEM indul el az óra (különben némán törölnénk)', async () => {
    email.sendDormantAccountWarningEmail.mockRejectedValue(new Error('SMTP le'));
    const u = await alvoFiok(DORMANT_WARN_YEARS + 1);

    await purgeDormantAccounts();

    const { rows } = await db.query('SELECT dormant_warned_at FROM users WHERE id = $1', [u.id]);
    expect(
      rows[0].dormant_warned_at,
      'A figyelmeztető e-mail elbukott, mégis elindult a 30 napos óra — '
      + 'a felhasználó ÉRTESÍTÉS NÉLKÜL veszítené el a fiókját.',
    ).toBeNull();
  });
});
