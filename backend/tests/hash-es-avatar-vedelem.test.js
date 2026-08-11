// =====================================================================
//  OKMÁNY-LENYOMAT HMAC + AZ AVATAR-MEZŐ MEGBÍZHATÓSÁGA (2026-08-10)
//
//  1) A `doc_number_hash` sózatlan SHA-256 volt. A személyi igazolvány
//     számának értéktere teljesen felsorolható (~10⁸), tehát egy DB-dumpból
//     jelöltlistával VISSZAFEJTHETŐ — miközben három helyen (tájékoztató,
//     DPIA, kód-komment) azt állítottuk, hogy nem. Ráadásul a 061-es
//     migráció EGY NAPPAL KORÁBBAN szó szerint leírta ugyanezt az érvelést
//     az e-mail-lenyomatra, és emiatt váltott HMAC-ra.
//
//  2) Az `avatar_url` szabadon írható volt a PATCH /auth/me-vel. Amióta az
//     avatar-csere TÖRLI a régi fájlt a tárolóból, ez BIZONYÍTÉK-
//     MEGSEMMISÍTŐ eszközzé vált: a támadó beírja egy másik felhasználó
//     fuvar-fotójának URL-jét, feltölt egy új avatart, és a kód „régi
//     avatarként" letörli az áldozat fotóját.
//     ⚠️ Ez a rés a fájl-törlés bevezetésével KELETKEZETT: előtte egy hamis
//     avatar_url ártalmatlan volt. A tanulság osztály-szintű: SZABADON
//     ÍRHATÓ mezőre nem szabad visszafordíthatatlan műveletet alapozni.
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const storage = require('../src/services/storage');

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);
const auth = (t) => ({ Authorization: `Bearer ${t}` });
afterEach(() => { vi.restoreAllMocks(); });

describe('Az okmány-lenyomat nem visszafejthető', () => {
  it('a tárolt lenyomat NEM a nyers okmányszám SHA-256-ja', async () => {
    const user = await createUser({ role: 'carrier' });
    const okmanyszam = 'AB1234567';
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/x.jpg');
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: true, confidence: 0.95, documentNumber: okmanyszam,
      holder_name: null, likely_copy: false, birthDate: '1990-01-01',
    });

    await request(app).post('/auth/kyc-document').set(auth(user.token))
      .field('doc_type', 'id_card').attach('file', JPEG, 'o.jpg');

    const { rows } = await db.query(
      'SELECT doc_number_hash, hash_algo FROM kyc_documents WHERE user_id = $1', [user.id],
    );
    expect(rows[0], 'nem jött létre KYC-sor').toBeTruthy();

    const sozatlan = require('crypto').createHash('sha256').update(okmanyszam).digest('hex');
    expect(
      rows[0].doc_number_hash,
      'a lenyomat a nyers okmányszám SÓZATLAN SHA-256-ja — az okmányszámok tere '
      + 'felsorolható, tehát egy DB-szivárgásból jelöltlistával visszafejthető',
    ).not.toBe(sozatlan);
    expect(rows[0].hash_algo).toBe('hmac-sha256');
  });

  it('a duplikátum-védelem: ugyanazzal az okmánnyal nem nyílik ÉSZREVÉTLENÜL új fiók', async () => {
    // ⚠️ 2026-08-11: ez a teszt korábban a LEGACY (sózatlan) lenyomatra
    // illesztést őrizte — az „átmeneti" ágat, amikor a régi sorok még
    // sózatlanul léteztek. A 073-as migráció ezeket kinullázta (a sózatlan
    // hash ezen az értéktéren visszafejthető, és három publikált dokumentumnak
    // mondott ellent), az átmeneti illesztés pedig kikerült a kódból.
    //
    // A VÉDENDŐ GARANCIA VÁLTOZATLAN, csak a HMAC-os — vagyis az élő — úton
    // mérjük: ugyanazzal az okmánnyal nem lehet ÉSZREVÉTLENÜL új, hitelesített
    // fiókot nyitni. A teszt szándékosan nem tűnt el a legacy-ág törlésével.
    const { hmac } = require('../src/utils/pepper');
    const regi = await createUser({ role: 'carrier' });
    const uj2 = await createUser({ role: 'carrier' });
    const okmanyszam = 'CD7654321';
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status, doc_number_hash, hash_algo)
       VALUES ($1, 'id_card', 'private:kyc/regi.jpg', 'approved', $2, 'hmac-sha256')`,
      [regi.id, hmac(okmanyszam)],
    );

    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/uj.jpg');
    vi.spyOn(require('../src/services/gemini'), 'verifyKycDocument').mockResolvedValue({
      valid: true, confidence: 0.95, documentNumber: okmanyszam,
      holder_name: null, likely_copy: false, birthDate: '1990-01-01',
    });

    const res = await request(app).post('/auth/kyc-document').set(auth(uj2.token))
      .field('doc_type', 'id_card').attach('file', JPEG, 'o.jpg');

    // A duplikátum NEM automatikus elutasítás, hanem KÉZI ELLENŐRZÉS
    // (GDPR 22.: a lenyomat az AI OCR-jéből származik, egy félreolvasás nem
    // zárhat ki jóhiszemű felhasználót ember nélkül).
    expect(res.status).toBe(200);
    const { rows: dok } = await db.query(
      'SELECT status FROM kyc_documents WHERE user_id = $1', [uj2.id],
    );
    expect(
      dok[0]?.status,
      'Ugyanazzal az okmánnyal ÉSZREVÉTLENÜL új, hitelesített fiók nyílt — '
      + 'az „egy okmány = egy fiók" védelem nem futott le.',
    ).not.toBe('approved');
  });

  it('a PATCH /auth/me NEM állíthatja az avatar_url-t', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [user.id, 'https://r2.pelda.hu/sajat.jpg']);

    await request(app).patch('/auth/me').set(auth(user.token))
      .send({ avatar_url: 'https://r2.pelda.hu/MASE-fotoja.jpg' });

    const { rows } = await db.query('SELECT avatar_url FROM users WHERE id = $1', [user.id]);
    expect(
      rows[0].avatar_url,
      'a felhasználó szabadon átírhatta az avatar_url-t egy MÁSIK ember fájljára',
    ).toBe('https://r2.pelda.hu/sajat.jpg');
  });

  it('a teljes támadási lánc nem törli a MÁSIK felhasználó fotóját', async () => {
    const tamado = await createUser({ role: 'shipper' });
    const aldozatFotoja = 'https://r2.pelda.hu/aldozat-felveteli-foto.jpg';
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [tamado.id, 'https://r2.pelda.hu/sajat-avatar.jpg']);

    // 1. lépés: az áldozat fotójának URL-jét a saját avatar-mezőbe írná
    await request(app).patch('/auth/me').set(auth(tamado.token)).send({ avatar_url: aldozatFotoja });

    // 2. lépés: új avatar feltöltése → a kód a „régi avatart" törli
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
    vi.spyOn(storage, 'saveFile').mockResolvedValue('https://r2.pelda.hu/uj-avatar.jpg');
    await request(app).post('/auth/avatar').set(auth(tamado.token)).attach('file', JPEG, 'k.jpg');

    expect(
      torles.mock.calls.flat(),
      'BIZONYÍTÉK-MEGSEMMISÍTÉS: a támadó két API-hívással letörölte egy másik '
      + 'felhasználó felvételi fotóját (a vitarendezés bizonyítékát)',
    ).not.toContain(aldozatFotoja);
  });

  it('a saját avatar cseréje viszont továbbra is takarít (nem lett árva)', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [user.id, 'https://r2.pelda.hu/regi-sajat.jpg']);
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
    vi.spyOn(storage, 'saveFile').mockResolvedValue('https://r2.pelda.hu/uj.jpg');

    await request(app).post('/auth/avatar').set(auth(user.token)).attach('file', JPEG, 'k.jpg');

    expect(
      torles.mock.calls.flat(),
      'a védelem túl széles lett: a SAJÁT régi avatar sem törlődik többé (árva fájl)',
    ).toContain('https://r2.pelda.hu/regi-sajat.jpg');
  });
});
