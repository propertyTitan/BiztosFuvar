import { expect, it, vi } from 'vitest';
const { db, createUser, createJob } = require('./helpers');
const { scanPublicImages, createSourceReader } = require('../scripts/public-image-dry-run');
const sharp = require('sharp');
const { Readable } = require('stream');

// A teljes készlet közös adatbázisában korábbi tesztek képei is élnek.
// Valódi SQL-leltár, de csak e próba saját sorainak tranzakciós másolatán.
async function withInventory(ownerId, check) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE users ON COMMIT DROP AS SELECT * FROM public.users WHERE id=$1', [ownerId]);
    await client.query('CREATE TEMP TABLE photos ON COMMIT DROP AS SELECT * FROM public.photos WHERE uploader_id=$1', [ownerId]);
    await client.query('CREATE TEMP TABLE disputes ON COMMIT DROP AS SELECT * FROM public.disputes WHERE evidence_url IN (SELECT url FROM photos)');
    await check(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

it('a batch leltár felismeri a metaadatot, lapozható és nem változtatja meg a DB-t', async () => {
  const owner = await createUser();
  const url = 'https://images.test/11111111111111111111111111111111.png';
  await db.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [url, owner.id]);
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
    .png().withExif({ IFD0: { Artist: 'sensitive-test-name' } }).toBuffer();
  const before = (await db.query('SELECT * FROM users WHERE id=$1', [owner.id])).rows[0];
  const readImage = vi.fn(async () => buffer);
  await withInventory(owner.id, async client => {
    const first = await scanPublicImages({ db: client, readImage, kind: 'avatar', limit: 1 });
    expect(first.results[0]).toMatchObject({ id: owner.id, action: 'sanitize', metadata_present: true });
    expect(JSON.stringify(first)).not.toContain('sensitive-test-name');
    expect((await scanPublicImages({ db: client, readImage, kind: 'avatar', after: first.next_cursor })).scanned).toBe(0);
    expect((await client.query('SELECT * FROM users WHERE id=$1', [owner.id])).rows[0]).toEqual(before);
    expect((await scanPublicImages({ db: client, readImage, kind: 'avatar', limit: 1 })).results).toEqual(first.results);
  });
});

it('a bizonyítékként hivatkozott listing eredetije külön kézi ellenőrzésre kerül', async () => {
  const owner = await createUser(), job = await createJob({ shipperId: owner.id });
  const url = 'https://images.test/22222222222222222222222222222222.png';
  await db.query("INSERT INTO photos(job_id,uploader_id,kind,url) VALUES($1,$2,'listing',$3),($1,$2,'pickup',$3)", [job.id, owner.id, url]);
  const readImage = vi.fn();
  await withInventory(owner.id, async client => {
    const result = await scanPublicImages({ db: client, readImage, kind: 'listing' });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].action).toBe('manual_review_evidence_reference');
    expect(readImage).not.toHaveBeenCalled();
  });
  expect((await db.query('SELECT 1 FROM photos WHERE url=$1', [url])).rowCount).toBe(2);
});

it('ismeretlen és manipulált URL esetén még tárhely-olvasás sincs', async () => {
  const client = { send: vi.fn() };
  const read = createSourceReader({ client, bucket: 'test', publicUrl: 'https://images.test' });
  for (const url of ['http://127.0.0.1/private', 'https://images.test.evil/key', 'https://images.test/../secret', '/uploads/old.jpg']) {
    await expect(read(url)).rejects.toThrow('UNSUPPORTED_SOURCE');
  }
  expect(client.send).not.toHaveBeenCalled();
});

it('ismert saját objektumot korlátozott GET-tel olvas, író parancs nélkül', async () => {
  const body = Buffer.from('image-data');
  const client = { send: vi.fn(async () => ({ Body: Readable.from([body]), ContentLength: body.length })) };
  const read = createSourceReader({ client, bucket: 'test', publicUrl: 'https://images.test' });
  expect(await read('https://images.test/11111111111111111111111111111111.png')).toEqual(body);
  expect(client.send).toHaveBeenCalledTimes(1);
  expect(client.send.mock.calls[0][0].constructor.name).toBe('GetObjectCommand');
});
