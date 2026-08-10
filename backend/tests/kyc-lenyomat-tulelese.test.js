// =====================================================================
//  AZ OKMÁNY-LENYOMAT TÚLÉLI A FIÓK TÖRLÉSÉT (2026-08-10, user-döntés)
//
//  „A fiók törlésével ne lehessen újra regisztrálni kvázi újként."
//
//  Az adatkezelési tájékoztató, a 30. cikk nyilvántartás ÉS egy teljes
//  érdekmérlegelési teszt (II.) is azt állította, hogy az okmányszám
//  lenyomatát a fiók megszűnése után 5 évig megőrizzük — csalásvédelmi
//  célból. A séma viszont cáfolta: `kyc_documents.user_id ON DELETE CASCADE`,
//  tehát a lenyomat AZONNAL eltűnt. A kitiltott felhasználó törölte a
//  fiókját, és ugyanazzal a személyivel visszajött, tiszta lappal.
//
//  ⚠️ A védelem NEM kemény tiltás: a visszatérő KYC-je EMBERI ellenőrzésre
//  kerül. A cél nem a kizárás, hanem hogy ne lehessen ELŐZMÉNY NÉLKÜLI,
//  „friss" fiókként visszajönni.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { db, createUser } = require('./helpers');
const kycHistory = require('../src/utils/kycHistory');
const { purgeOldKycDocHistory, HOLD_RETENTION_YEARS } = require('../src/services/retention');

const HASH = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

/** Fiók KYC-dokumentummal, adott okmány-lenyomattal. */
async function kycesUser(hash) {
  const user = await createUser({ role: 'carrier' });
  await db.query(
    `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, doc_number_hash)
     VALUES ($1, 'id_card', 'private:kyc/x.jpg', 'approved', $2)`,
    [user.id, hash],
  );
  await kycHistory.rogzitLenyomat(hash);
  return user;
}

describe('A lenyomat túléli a fiók törlését', () => {
  it('a törlés UTÁN is tudjuk, hogy ezzel az okmánnyal volt már fiók', async () => {
    const hash = HASH(`okmany-${Date.now()}-${Math.random()}`);
    const user = await kycesUser(hash);

    // Fiók-törlés, ahogy az élesben megy (jelölés a CASCADE ELŐTT)
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await kycHistory.jeloldToroltFioknak(client, user.id, 'self');
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);
      await client.query('COMMIT');
    } finally { client.release(); }

    const elozmeny = await kycHistory.korabbanToroltFiok(hash);
    expect(
      elozmeny,
      'a lenyomat a CASCADE-del eltűnt — ugyanazzal a személyivel, előzmény '
      + 'nélkül vissza lehetne regisztrálni',
    ).toBeTruthy();
    expect(elozmeny.deleted_account_count).toBe(1);
  });

  it('az ADMIN általi törlés (kitiltás) is nyomot hagy', async () => {
    const hash = HASH(`kitiltott-${Date.now()}-${Math.random()}`);
    const user = await kycesUser(hash);

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await kycHistory.jeloldToroltFioknak(client, user.id, 'admin');
      await client.query('DELETE FROM users WHERE id = $1', [user.id]);
      await client.query('COMMIT');
    } finally { client.release(); }

    const elozmeny = await kycHistory.korabbanToroltFiok(hash);
    expect(elozmeny.last_deletion_reason, 'nem derül ki, hogy kitiltás volt').toBe('admin');
  });

  it('az ÉLŐ fiók okmánya NEM számít előzménynek (nem akasztja meg a normál utat)', async () => {
    const hash = HASH(`elo-${Date.now()}-${Math.random()}`);
    await kycesUser(hash);
    expect(
      await kycHistory.korabbanToroltFiok(hash),
      'egy sosem törölt fiók okmánya kézi ellenőrzésre küldené a felhasználót',
    ).toBeNull();
  });

  it('csak LENYOMAT tárolódik — az okmányszám sosem', async () => {
    const okmanyszam = 'AB1234567';
    const hash = HASH(okmanyszam);
    await kycesUser(hash);

    const { rows } = await db.query('SELECT * FROM kyc_doc_history WHERE doc_number_hash = $1', [hash]);
    expect(JSON.stringify(rows[0]), 'a NYERS okmányszám bekerült a táblába').not.toContain(okmanyszam);
  });
});

describe('A lenyomat is elévül (5 év — amit a tájékoztató ígér)', () => {
  it('az 5 évnél régebbi lenyomat törlődik', async () => {
    const hash = HASH(`regi-${Date.now()}-${Math.random()}`);
    await db.query(
      `INSERT INTO kyc_doc_history (doc_number_hash, last_seen_at)
       VALUES ($1, NOW() - ($2 || ' years')::interval - INTERVAL '1 day')`,
      [hash, HOLD_RETENTION_YEARS],
    );

    await purgeOldKycDocHistory();

    const { rowCount } = await db.query('SELECT 1 FROM kyc_doc_history WHERE doc_number_hash = $1', [hash]);
    expect(rowCount, 'a lenyomat 5 év után is megmaradt — a megőrzés határtalan lenne').toBe(0);
  });

  it('a friss lenyomat marad', async () => {
    const hash = HASH(`friss-${Date.now()}-${Math.random()}`);
    await kycHistory.rogzitLenyomat(hash);
    await purgeOldKycDocHistory();
    const { rowCount } = await db.query('SELECT 1 FROM kyc_doc_history WHERE doc_number_hash = $1', [hash]);
    expect(rowCount).toBe(1);
  });
});
