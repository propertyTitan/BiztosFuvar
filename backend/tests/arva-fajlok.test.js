// =====================================================================
//  ÁRVA TÁROLT FÁJLOK (2026-08-09, a három független adatvédelmi lencse)
//
//  Az árva fájl az a hibaosztály, ahol a DB-sor eltűnik, a TÁROLT OBJEKTUM
//  viszont marad — és mivel minden takarító körünk a DB-sorokból olvassa a
//  kulcsokat, onnantól SOHA többé nem érjük el. A GDPR 17. cikk (törléshez
//  való jog) szempontjából ez a legrosszabb fajta hiba: azt hisszük,
//  töröltünk, de nem.
//
//  Négy úton keletkezett:
//   1) KYC-ÚJRAFELTÖLTÉS — a legsúlyosabb: a SZEMÉLYI IGAZOLVÁNY fotója.
//      Új véletlen kulcs + ON CONFLICT felülírás → az előző fotó elveszik.
//      És ez a NORMÁL út: a kockázati jelre pending-be tett dokumentumnál
//      az értesítés kifejezetten újrafeltöltésre kéri a felhasználót.
//   2) AVATAR-CSERE — ugyanez, a PUBLIKUS bucketben, 1 éves cache-sel.
//   3) A MÁSIK FÉL fotói — a gyűjtő csak `uploader_id = <user>`-re nézett,
//      így a feladó fiók-törlésekor a szállító fotói bennragadtak.
//   4) VITA-BIZONYÍTÉK — a `disputes.evidence_url` egyik gyűjtőben sem volt.
// =====================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';

// Valódi JPEG-fejléc: a feltöltés magic-byte ellenőrzést végez, a csonka
// fejlécet 400-zal dobja — akkor a vizsgált kód el sem indulna.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
  0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
]);

const { app, db, createUser, createJob } = require('./helpers');
const storage = require('../src/services/storage');
const { collectUserFileKeys, collectEntityFileKeys } = require('../src/utils/userFiles');

afterEach(() => { vi.restoreAllMocks(); });
const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe('Felülírás nem hagyhat árvát', () => {
  it('KYC-újrafeltöltéskor az ELŐZŐ okmányfotó törlődik a tárolóból', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query(
      `INSERT INTO kyc_documents (user_id, doc_type, file_url, status)
       VALUES ($1, 'id_card', 'private:kyc/REGI-OKMANY.jpg', 'pending')`,
      [user.id],
    );
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
    vi.spyOn(storage, 'savePrivateFile').mockResolvedValue('private:kyc/UJ-OKMANY.jpg');

    await request(app)
      .post('/auth/kyc-document')
      .set(auth(user.token))
      .field('doc_type', 'id_card')
      .attach('file', JPEG, 'okmany.jpg');

    expect(
      torles.mock.calls.flat(),
      'ÁRVA: a SZEMÉLYI IGAZOLVÁNY előző fotója a privát bucketben maradt, '
      + 'és egyetlen retenciós kör sem éri el többé',
    ).toContain('private:kyc/REGI-OKMANY.jpg');
  });

  it('avatar-cserekor az előző profilkép törlődik', async () => {
    const user = await createUser({ role: 'shipper' });
    await db.query('UPDATE users SET avatar_url = $2 WHERE id = $1', [user.id, 'https://r2.pelda.hu/regi-avatar.jpg']);
    const torles = vi.spyOn(storage, 'deleteFile').mockResolvedValue(true);
    vi.spyOn(storage, 'saveFile').mockResolvedValue('https://r2.pelda.hu/uj-avatar.jpg');

    await request(app)
      .post('/auth/avatar')
      .set(auth(user.token))
      .attach('file', JPEG, 'kep.jpg');

    expect(
      torles.mock.calls.flat(),
      'ÁRVA: a régi profilkép a PUBLIKUS bucketben maradt, 1 éves cache-sel',
    ).toContain('https://r2.pelda.hu/regi-avatar.jpg');
  });
});

describe('A fiók-törlés a MÁSIK fél fájljait is elviszi', () => {
  it('a feladó törlésekor a szállító fuvar-fotói is a gyűjtésben vannak', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, carrierId: szallito.id, status: 'delivered', paid: true });
    await db.query(
      `INSERT INTO photos (job_id, uploader_id, kind, url) VALUES ($1, $2, 'pickup', $3)`,
      [job.id, szallito.id, 'https://r2.pelda.hu/szallito-fotoja.jpg'],
    );

    const kulcsok = await collectUserFileKeys(felado.id);

    expect(
      kulcsok,
      'ÁRVA: a feladó fiók-törlése CASCADE-del elvitte a fotó DB-sorát, '
      + 'de a szállító feltöltött képe (a GPS-koordinátájával) az R2-ben maradt',
    ).toContain('https://r2.pelda.hu/szallito-fotoja.jpg');
  });

  it('a vita csatolt bizonyítéka is a gyűjtésben van', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'delivered', paid: true });
    await db.query(
      `INSERT INTO disputes (job_id, opened_by, description, evidence_url, status)
       VALUES ($1, $2, 'sérült', $3, 'open')`,
      [job.id, felado.id, 'https://r2.pelda.hu/vita-bizonyitek.jpg'],
    );

    const kulcsok = await collectUserFileKeys(felado.id);
    expect(kulcsok, 'ÁRVA: a vita bizonyíték-fájlja a tárolóban maradt').toContain('https://r2.pelda.hu/vita-bizonyitek.jpg');
  });

  it('admin fuvar-törlésnél is beleszámít a vita bizonyítéka', async () => {
    const felado = await createUser({ role: 'shipper' });
    const job = await createJob({ shipperId: felado.id, status: 'cancelled' });
    await db.query(
      `INSERT INTO disputes (job_id, opened_by, description, evidence_url, status)
       VALUES ($1, $2, 'sérült', $3, 'open')`,
      [job.id, felado.id, 'https://r2.pelda.hu/admin-vita.jpg'],
    );

    const kulcsok = await collectEntityFileKeys('job', job.id);
    expect(kulcsok).toContain('https://r2.pelda.hu/admin-vita.jpg');
  });
});
