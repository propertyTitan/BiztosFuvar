// Egyetlen tárolási absztrakció: Cloudflare R2 (prod) vagy lokális
// filesystem (dev fallback). A routes/photos.js és routes/auth.js
// ezt használja a saveFile() függvénnyel.
//
// Miért így? A Railway container filesystem-je **ephemeral**:
// minden redeploy / restart után eldobja a tartalmat. Ezért éles
// környezetben kötelező egy perzisztens object storage.
//
// Cloudflare R2 választás oka:
//   ✅ S3-kompatibilis (AWS SDK-val működik)
//   ✅ INGYEN az egress (nincs kiutazási díj, szemben S3-mal)
//   ✅ 10 GB / hó tárolás ingyen
//   ✅ EU régió (adatvédelem)
//   ✅ Custom domain támogatás
//
// Env változók (mind kötelező R2 módhoz):
//   R2_ACCOUNT_ID        – Cloudflare account ID (dashboard → R2 → API Tokens alatt)
//   R2_ACCESS_KEY_ID     – R2 API Token Access Key ID
//   R2_SECRET_ACCESS_KEY – R2 API Token Secret Access Key
//   R2_BUCKET_NAME       – pl. gofuvar-uploads
//   R2_PUBLIC_URL        – a bucket publikus URL prefix-e,
//                          pl. https://pub-xxx.r2.dev (dev URL)
//                          vagy https://files.gofuvar.hu (saját domain)
//
// Ha az R2_* env változók közül akár csak egy is hiányzik → disk fallback.

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Lokális disk fallback mappa
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// R2 (S3-kompatibilis) kliens — csak akkor inicializáljuk, ha az env
// változók megvannak. Különben `null` marad és disk fallback-et használunk.
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

  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET_NAME ||
    !R2_PUBLIC_URL
  ) {
    return null;
  }

  try {
    // Lazy require: ha a package nincs telepítve (pl. régi deploy),
    // ne törjük össze a boot-ot — visszatérünk null-lal, és disk fallback.
    const { S3Client } = require('@aws-sdk/client-s3');

    const client = new S3Client({
      region: 'auto', // R2 region-agnostic
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    return {
      client,
      bucket: R2_BUCKET_NAME,
      // Defenzív tisztítás: bármely `<` vagy `>` karaktert (pl. Safari /
      // clipboard auto-link felismerés a Raw Editor beillesztésnél), plusz
      // trailing slash → levágjuk. Így robusztus a rossz env paste ellen.
      publicUrl: R2_PUBLIC_URL.trim().replace(/[<>]/g, '').replace(/\/$/, ''),
    };
  } catch (err) {
    console.warn('[storage] R2 client init sikertelen, disk fallback:', err.message);
    return null;
  }
}

r2Config = initR2();
r2Client = r2Config?.client || null;

if (r2Client) {
  console.log(`[storage] Cloudflare R2 aktív — bucket: ${r2Config.bucket}`);
} else {
  console.log('[storage] Lokális disk mód — Railway-en ez NEM perzisztens!');
}

/**
 * Fájl mentése — vagy R2-re, vagy a lokális filesystem-re.
 *
 * @param {Buffer} buffer – a fájl bináris tartalma (pl. multer memoryStorage)
 * @param {string} originalName – eredeti fájlnév (csak az extension számít)
 * @param {string} mimetype – pl. 'image/jpeg'
 * @returns {Promise<string>} a fájl publikus URL-je (R2 esetén teljes URL,
 *                            disk esetén `/uploads/xxx.jpg` relatív)
 */
async function saveFile(buffer, originalName, mimetype) {
  const ext = (originalName?.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = /^[a-z0-9]{1,6}$/.test(ext) ? ext : 'jpg';
  const filename = `${crypto.randomBytes(16).toString('hex')}.${safeExt}`;

  // ── R2 mód ──
  if (r2Client && r2Config) {
    try {
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await r2Client.send(
        new PutObjectCommand({
          Bucket: r2Config.bucket,
          Key: filename,
          Body: buffer,
          ContentType: mimetype || 'application/octet-stream',
          // Cache-Control: a képek immutable-ek (hash-név), évekig cache-elhetők
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${r2Config.publicUrl}/${filename}`;
    } catch (err) {
      // Ha R2 upload sikertelen, **ne** dobjunk — essünk vissza diskre,
      // hogy a user legalább lássa a képet az aktuális sessionben.
      console.error('[storage] R2 upload hiba, disk fallback:', err.message);
    }
  }

  // ── Disk fallback ──
  const filepath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return `/uploads/${filename}`;
}

/**
 * Igazat ad vissza, ha R2 aktív. A hívó tudni akarja, perzisztens-e.
 */
function isPersistent() {
  return r2Client !== null;
}

module.exports = { saveFile, isPersistent };
