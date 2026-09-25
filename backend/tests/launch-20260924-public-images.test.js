import { afterEach, expect, it, vi } from 'vitest';
import request from 'supertest';
const { app, createUser, createJob, TINY_PNG } = require('./helpers');
const storage = require('../src/services/storage');
const auth = user => ['Authorization', `Bearer ${user.token}`];
afterEach(() => vi.restoreAllMocks());

// Szabályos PNG eXIf/TIFF GPS IFD, kizárólag mesterséges koordinátával.
function gpsPhoto() {
  const tiff = Buffer.alloc(128);
  tiff.write('II', 0); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8); tiff.writeUInt16LE(0x8825, 10); tiff.writeUInt16LE(4, 12);
  tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18); tiff.writeUInt16LE(4, 26);
  function entry(offset, tag, type, count, value) {
    tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8);
  }
  entry(28, 1, 2, 2, 78); entry(40, 2, 5, 3, 80); entry(52, 3, 2, 2, 69); entry(64, 4, 5, 3, 104);
  [47, 30, 12, 19, 2, 34].forEach((n, i) => { tiff.writeUInt32LE(n, 80 + i * 8); tiff.writeUInt32LE(1, 84 + i * 8); });
  const type = Buffer.from('eXIf'); let crc = 0xffffffff;
  for (const byte of Buffer.concat([type, tiff])) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(tiff.length + 12);
  chunk.writeUInt32BE(tiff.length, 0); type.copy(chunk, 4); tiff.copy(chunk, 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([TINY_PNG.subarray(0, 33), chunk, TINY_PNG.subarray(33)]);
}

async function imageBytes(url) {
  if (url.startsWith('data:')) return Buffer.from(url.split(',')[1], 'base64');
  const response = await request(app).get(url).buffer(true).parse((res, done) => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks)));
  });
  expect(response.status).toBe(200);
  return response.body;
}

it.each([false, true])('a kívülálló listing képe GPS-mentes; DB fallback=%s', async fallback => {
  const owner = await createUser(), outsider = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: owner.id, status: 'pending' });
  if (fallback) vi.spyOn(storage, 'saveFile').mockRejectedValue(new Error('R2 unavailable'));
  const upload = await request(app).post(`/jobs/${job.id}/photos`).set(...auth(owner))
    .field('kind', 'listing').attach('file', gpsPhoto(), { filename: 'gps.png', contentType: 'image/png' });
  expect(upload.status, JSON.stringify(upload.body)).toBe(201);
  const listing = await request(app).get(`/jobs/${job.id}/photos`).set(...auth(outsider));
  expect(listing.status).toBe(200); expect(listing.body).toHaveLength(1);
  const bytes = await imageBytes(listing.body[0].url);
  expect(bytes.includes(Buffer.from('eXIf'))).toBe(false);
});

it('a nyilvános avatarból is eltűnik a beágyazott GPS', async () => {
  const user = await createUser();
  const response = await request(app).post('/auth/avatar').set(...auth(user))
    .attach('file', gpsPhoto(), { filename: 'avatar.png', contentType: 'image/png' });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect((await imageBytes(response.body.url)).includes(Buffer.from('eXIf'))).toBe(false);
});

it('a felvételi bizonyító kép eredeti bájtjai változatlanok', async () => {
  const owner = await createUser(), carrier = await createUser({ role: 'carrier' });
  const job = await createJob({ shipperId: owner.id, carrierId: carrier.id, status: 'accepted', paid: true });
  const original = gpsPhoto();
  const response = await request(app).post(`/jobs/${job.id}/photos`).set(...auth(carrier))
    .field('kind', 'pickup').attach('file', original, { filename: 'evidence.png', contentType: 'image/png' });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  expect((await imageBytes(response.body.photo.url)).equals(original)).toBe(true);
});

it.each(['jpeg', 'png', 'webp', 'avif'])('a %s publikus kép megjeleníthető és EXIF/XMP-mentes', async format => {
  const sharp = require('sharp');
  const source = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#27a861' } })
    .toFormat(format).withExif({ IFD0: { Artist: 'private-photo-owner' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '47/1 30/1 12/1' } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">private-photo-owner</x:xmpmeta>').toBuffer();
  const original = await sharp(source).metadata(); expect(original.exif).toBeTruthy();
  const output = await require('../src/services/publicImage').sanitizePublicImage({ buffer: source, mimetype: `image/${format}` });
  const metadata = await sharp(output.buffer).metadata();
  expect(metadata.width).toBe(3); expect(metadata.height).toBe(2);
  expect(metadata.exif).toBeUndefined(); expect(metadata.xmp).toBeUndefined(); expect(metadata.iptc).toBeUndefined();
});

it('az EXIF tájolás alkalmazása után is helyes irányú a JPEG', async () => {
  const sharp = require('sharp');
  const source = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#27a861' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const result = await require('../src/services/publicImage').sanitizePublicImage({ buffer: source });
  const metadata = await sharp(result.buffer).metadata();
  expect([metadata.width, metadata.height]).toEqual([2, 3]); expect(metadata.exif).toBeUndefined();
});

it('az animált GIF összes képkockája és ismétlése megmarad', async () => {
  const sharp = require('sharp');
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0]);
  const source = await sharp(pixels, { raw: { width: 1, height: 2, channels: 3, pageHeight: 1 } })
    .gif({ loop: 3, delay: [100, 200] }).toBuffer();
  const result = await require('../src/services/publicImage').sanitizePublicImage({ buffer: source });
  const metadata = await sharp(result.buffer, { animated: true }).metadata();
  expect(metadata.pages).toBe(2); expect(metadata.loop).toBe(3); expect(metadata.delay).toEqual([100, 200]);
});

it.each(['listing', 'avatar'])('a hibás %s kép nem jut se tárhelyre, se nyers fallbackbe', async type => {
  const user = await createUser(); const save = vi.spyOn(storage, 'saveFile');
  const invalid = Buffer.concat([TINY_PNG.subarray(0, 12), Buffer.from('broken-image-with-private-data')]);
  const endpoint = type === 'avatar' ? '/auth/avatar'
    : `/jobs/${(await createJob({ shipperId: user.id, status: 'pending' })).id}/photos`;
  let upload = request(app).post(endpoint).set(...auth(user));
  if (type === 'listing') upload = upload.field('kind', 'listing');
  const response = await upload.attach('file', invalid, { filename: 'broken.png', contentType: 'image/png' });
  expect(response.status).toBe(400); expect(response.body.code).toBe('INVALID_PUBLIC_IMAGE');
  expect(save).not.toHaveBeenCalled();
});
