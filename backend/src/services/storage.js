// Privát storage layer — a file-rendszer egyetlen érintőfelülete.
//
// A modul KÉT fő dolgot csinál:
//   1) `saveFile()` — feltölti a buffer-t R2-re (vagy disk fallback-re),
//      visszaad metaadatot (storage_key, hash, size, mime). NEM URL-t.
//   2) `streamObject()` — egy korábban mentett objektumot a megadott
//      Express response-ba pipe-ol. A jogosultság-check a hívó dolga.
//
// A kliens SOSE látja a storage_key-t. Az új `routes/files.js` az egyetlen
// kapu — auth + permission + audit log után streameli vissza.
//
// Cloudflare R2 választás oka:
//   ✅ S3-kompatibilis (AWS SDK-val működik)
//   ✅ INGYEN az egress
//   ✅ EU régió-jurisdikció külön kérhető (R2 EU-only)
//   ✅ AES-256 server-side encryption alapból
//
// FONTOS: a bucket NEM lehet publikus. A Cloudflare dashboard-on a
// "Public Access" KIKAPCSOLVA. Az `R2_PUBLIC_URL` env változó már nem
// szükséges (és nem is ajánlott — figyelmeztetést írunk ha látjuk).
//
// Env változók (R2 módhoz mind kötelező):
//   R2_ACCOUNT_ID
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET_NAME

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Dev disk fallback. Production-ban tilos route-hoz kötni — a
// `/uploads` static serve-t a `routes/index.js` mostantól csak NODE_ENV
// !== 'production' esetén kapcsolja fel.
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let r2Client = null;
let r2Config = null;

function initR2() {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_PUBLIC_URL,
  } = process.env;

  if (R2_PUBLIC_URL) {
    console.warn(
      '[storage] R2_PUBLIC_URL be van állítva — privát módra váltás után' +
      ' ezt törölheted az env-ből, már nem használjuk. (Privát bucket-en' +
      ' a public URL UGYIS 404-et ad.)',
    );
  }

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    return null;
  }

  try {
    const { S3Client } = require('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
    return { client, bucket: R2_BUCKET_NAME };
  } catch (err) {
    console.warn('[storage] R2 client init sikertelen, disk fallback:', err.message);
    return null;
  }
}

r2Config = initR2();
r2Client = r2Config?.client || null;

if (r2Client) {
  console.log(`[storage] Cloudflare R2 PRIVATE mode — bucket: ${r2Config.bucket}`);
} else {
  console.log(
    '[storage] Disk módban fut (R2 env hiányzik). Production-ban EZT NE!' +
    ' A /uploads route nem lesz nyitva production-ban.',
  );
}

// Csak a-z 0-9 és pont — minden más extension `bin`. Védekezés
// path-traversal és kompromittált fájlnév-paste ellen.
function safeExt(originalName) {
  const ext = (originalName?.split('.').pop() || 'bin').toLowerCase();
  return /^[a-z0-9]{1,6}$/.test(ext) ? ext : 'bin';
}

// MIME-validáció — csak a tényleges magic-byte alapján szűrünk.
// A klienstől kapott `mimetype`-ra NEM hagyatkozunk.
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
]);
const ALLOWED_DOC_MIME = new Set([
  ...ALLOWED_IMAGE_MIME,
  'application/pdf',
]);

function detectMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
  ) return 'image/png';
  // WebP: "RIFF" .... "WEBP"
  if (
    buffer.slice(0, 4).toString() === 'RIFF' &&
    buffer.slice(8, 12).toString() === 'WEBP'
  ) return 'image/webp';
  // HEIC/HEIF: 0..3 size, 4..7 'ftyp', 8..11 brand (heic|heix|mif1|...)
  if (buffer.slice(4, 8).toString() === 'ftyp') {
    const brand = buffer.slice(8, 12).toString();
    if (['heic', 'heix', 'mif1', 'msf1', 'heim', 'heis'].includes(brand)) return 'image/heic';
  }
  // PDF: %PDF-
  if (buffer.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

/**
 * Buffer feltöltése R2-re vagy diskre.
 *
 * @param {Buffer} buffer
 * @param {string} originalName  – csak az extension számít
 * @param {string} mimetypeHint  – bizalmatlanul kezeljük; magic-byte felülírja
 * @param {object} opts
 *   - kind: 'kyc_license' | 'job_photo' | 'avatar' (a key prefixhez + MIME-szűréshez)
 *   - allowPdf: boolean (default false; csak KYC-nél engedjük)
 * @returns {Promise<{
 *   storage_key: string,
 *   storage_backend: 'r2' | 'disk',
 *   sha256: string,
 *   size_bytes: number,
 *   mime_type: string,
 * }>}
 */
async function saveFile(buffer, originalName, mimetypeHint, opts = {}) {
  const { kind = 'misc', allowPdf = false } = opts;

  // Magic-byte alapú MIME, NEM a kliens hint
  const detected = detectMime(buffer);
  if (!detected) {
    throw new Error('Nem felismert vagy nem támogatott fájltípus.');
  }
  const allowedSet = allowPdf ? ALLOWED_DOC_MIME : ALLOWED_IMAGE_MIME;
  if (!allowedSet.has(detected)) {
    throw new Error(`A(z) ${detected} fájltípus nem engedélyezett (${kind}).`);
  }

  const ext = safeExt(originalName);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  // Key séma: kind/yyyy/mm/<random>.<ext>. A dátum-prefix lehetővé teszi a
  // life-cycle szabályokat (pl. KYC fájl 90 nap után archiválódik).
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const random = crypto.randomBytes(16).toString('hex');
  const storage_key = `${kind}/${yyyy}/${mm}/${random}.${ext}`;

  if (r2Client && r2Config) {
    try {
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await r2Client.send(
        new PutObjectCommand({
          Bucket: r2Config.bucket,
          Key: storage_key,
          Body: buffer,
          ContentType: detected,
          // Privát objektum, de mégis: ne legyen indexelhető publikusan
          // ha valamiért előkerülne a key. A header az R2 oldalán is alkalmazódik.
          Metadata: { 'x-robots-tag': 'noindex, nofollow, noarchive' },
        }),
      );
      return {
        storage_key,
        storage_backend: 'r2',
        sha256,
        size_bytes: buffer.length,
        mime_type: detected,
      };
    } catch (err) {
      // R2 hiba production-ban kell hogy alert-eljen — most legalább logoljuk.
      // NEM esünk vissza diskre privát file-oknál: jobb ha a feltöltés
      // hibát ad, mintha érzékeny adat ephemeral diskre kerülne.
      console.error('[storage] R2 upload hiba:', err.message);
      throw new Error('Tárolás sikertelen, próbáld újra.');
    }
  }

  // Disk fallback — CSAK fejlesztésre.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Storage konfigurációs hiba: R2 nincs beállítva production módban. ' +
      'Add meg az R2_* env változókat.',
    );
  }
  const dir = path.join(UPLOADS_DIR, kind, String(yyyy), mm);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${random}.${ext}`), buffer);
  return {
    storage_key,
    storage_backend: 'disk',
    sha256,
    size_bytes: buffer.length,
    mime_type: detected,
  };
}

/**
 * Egy korábban mentett objektum streamelése egy Express response-ba.
 *
 * @param {{storage_key: string, storage_backend: string, mime_type?: string}} file
 * @param {import('express').Response} res
 */
async function streamObject(file, res) {
  if (file.storage_backend === 'r2') {
    if (!r2Client || !r2Config) {
      throw new Error('R2 nincs konfigurálva, de a file R2-re mutat.');
    }
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const result = await r2Client.send(
      new GetObjectCommand({ Bucket: r2Config.bucket, Key: file.storage_key }),
    );
    res.setHeader('Content-Type', result.ContentType || file.mime_type || 'application/octet-stream');
    if (result.ContentLength != null) {
      res.setHeader('Content-Length', String(result.ContentLength));
    }
    // No caching — a token gyorsan lejár, ne maradjon a böngésző cache-ében.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    // Pipe a stream
    result.Body.pipe(res);
    return;
  }

  // Disk
  const filepath = path.join(UPLOADS_DIR, file.storage_key);
  if (!fs.existsSync(filepath)) {
    throw new Error('A file nem található a disk-en.');
  }
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  fs.createReadStream(filepath).pipe(res);
}

/**
 * Egy korábban mentett objektum törlése a tárolóból. A `files` táblát NEM
 * piszkáljuk (azt a hívó intézi); itt csak a tényleges bytes-ot szabadítjuk fel.
 */
async function deleteObject(file) {
  if (file.storage_backend === 'r2') {
    if (!r2Client || !r2Config) return;
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await r2Client.send(
      new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: file.storage_key }),
    );
    return;
  }
  const filepath = path.join(UPLOADS_DIR, file.storage_key);
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
}

function isPrivateBackend() {
  return r2Client !== null;
}

module.exports = {
  saveFile,
  streamObject,
  deleteObject,
  isPrivateBackend,
};
