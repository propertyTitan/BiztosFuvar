// KYC privát tárolás — a storage-réteg privát körének szerkezeti őre.
//
// A biztonsági audit (2026-07-11) tétele: a személyi okmányok NE legyenek
// publikus URL-en. A teszt (disk-fallback módban, R2 nélkül) azt őrzi, hogy:
//  - a savePrivateFile 'private:<kulcs>' jelölőt ad vissza, sosem http URL-t
//  - a getSignedPrivateUrl a jelölőből olvasó-URL-t csinál, a nyers kulcsot
//    nem adja ki változatlanul
//  - a deleteFile a privát fájlt is törli
//  - publikus URL-re a getSignedPrivateUrl null-t ad (nem "aláír" bármit)
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { savePrivateFile, getSignedPrivateUrl, deleteFile } = require('../src/services/storage');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE_DIR = path.join(__dirname, '..', 'uploads', 'private');

describe('KYC privát tárolás (disk-fallback mód)', () => {
  it('a privát mentés private:<kulcs> jelölőt ad, nem publikus URL-t', async () => {
    const marker = await savePrivateFile(Buffer.from('teszt-okmany'), 'szemelyi.jpg', 'image/jpeg');
    expect(marker).toMatch(/^private:kyc\/[0-9a-f]{32}\.jpg$/);
    expect(marker).not.toMatch(/^https?:/);

    // a fájl a private mappában landolt
    const name = path.basename(marker.slice('private:'.length));
    expect(fs.existsSync(path.join(PRIVATE_DIR, name))).toBe(true);

    // olvasó-URL: disk módban a private útvonal; sosem a nyers jelölő
    const readUrl = await getSignedPrivateUrl(marker);
    expect(readUrl).toBeTruthy();
    expect(readUrl).not.toBe(marker);
    expect(readUrl).toContain(name);

    // törlés a privát körből is működik
    const deleted = await deleteFile(marker);
    expect(deleted).toBe(true);
    expect(fs.existsSync(path.join(PRIVATE_DIR, name))).toBe(false);
  });

  it('nem-privát bemenetre a getSignedPrivateUrl null-t ad', async () => {
    expect(await getSignedPrivateUrl('https://pub-x.r2.dev/abc.jpg')).toBeNull();
    expect(await getSignedPrivateUrl('')).toBeNull();
    expect(await getSignedPrivateUrl(null)).toBeNull();
  });
});

describe('Kép magic-byte azonosítás (audit 2. tétel)', () => {
  const { sniffImageType } = require('../src/utils/imageSniff');

  it('valódi képformátumokat felismer', () => {
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('image/png');
    expect(sniffImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp');
    expect(sniffImageType(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(4)]))).toBe('image/heic');
  });

  it('álcázott nem-képeket elutasít (SVG/HTML/szemét)', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageType(Buffer.from('<!DOCTYPE html><html><body>x</body></html>'))).toBeNull();
    expect(sniffImageType(Buffer.from('csak egy sima szoveg, nem kep'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(4))).toBeNull();
    expect(sniffImageType(null)).toBeNull();
  });
});
