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
    R2_PRIVATE_BUCKET_NAME,
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
      // PRIVÁT bucket (2026-07-13, biztonsági audit): a KYC-fotók ide
      // kerülnek — ennek NINCS publikus URL-je, csak rövid életű aláírt
      // (presigned) linkkel olvasható. Ha az env hiányzik, a privát mentés
      // a publikus bucketbe esik vissza (jelezve a logban) — a deploy ne
      // törjön, de a cél a R2_PRIVATE_BUCKET_NAME beállítása.
      privateBucket: R2_PRIVATE_BUCKET_NAME || null,
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
  if (r2Config.privateBucket) {
    console.log(`[storage] Privát (KYC) bucket aktív: ${r2Config.privateBucket}`);
  } else {
    console.warn('[storage] ⚠️ R2_PRIVATE_BUCKET_NAME nincs beállítva — a KYC-fotók a PUBLIKUS bucketbe mennek!');
  }
} else {
  console.log('[storage] Lokális disk mód — Railway-en ez NEM perzisztens!');
}

// Privát fájlok disk-fallback mappája (dev/teszt mód)
const PRIVATE_DIR = path.join(UPLOADS_DIR, 'private');
if (!fs.existsSync(PRIVATE_DIR)) fs.mkdirSync(PRIVATE_DIR, { recursive: true });

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
 * PRIVÁT fájl mentése (KYC-dokumentumok) — a privát R2 bucketbe, aminek
 * nincs publikus URL-je. A visszaadott érték egy `private:<kulcs>` jelölő,
 * ami a DB-be kerül; olvasni CSAK a getSignedPrivateUrl-lel lehet.
 * Disk-fallback (dev/teszt): uploads/private/ alá kerül.
 */
async function savePrivateFile(buffer, originalName, mimetype) {
  const ext = (originalName?.split('.').pop() || 'jpg').toLowerCase();
  const safeExt = /^[a-z0-9]{1,6}$/.test(ext) ? ext : 'jpg';
  const key = `kyc/${crypto.randomBytes(16).toString('hex')}.${safeExt}`;

  if (r2Client && r2Config) {
    try {
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      await r2Client.send(
        new PutObjectCommand({
          // Ha nincs külön privát bucket, a publikusba esünk vissza (a boot-
          // log figyelmeztet) — a kyc/ prefix ott is elkülöníti a fájlokat.
          Bucket: r2Config.privateBucket || r2Config.bucket,
          Key: key,
          Body: buffer,
          ContentType: mimetype || 'application/octet-stream',
          // NINCS public cache — a fájl aláírt URL-lel, rövid ideig olvasható
          CacheControl: 'private, no-store',
        }),
      );
      return `private:${key}`;
    } catch (err) {
      console.error('[storage] R2 privát upload hiba, disk fallback:', err.message);
    }
  }

  // Disk fallback — a kulcs fájlnév-része kerül a private mappába
  const filepath = path.join(PRIVATE_DIR, path.basename(key));
  fs.writeFileSync(filepath, buffer);
  return `private:${key}`;
}

/**
 * Rövid életű, aláírt olvasó-URL egy privát fájlhoz.
 * @param {string} privateUrl — a savePrivateFile által adott `private:<kulcs>`
 * @param {number} expiresIn — érvényesség másodpercben (default 10 perc)
 * @returns {Promise<string|null>} URL, vagy null ha a formátum ismeretlen
 */
async function getSignedPrivateUrl(privateUrl, expiresIn = 600) {
  if (!privateUrl || !privateUrl.startsWith('private:')) return null;
  const key = privateUrl.slice('private:'.length);
  if (!key) return null;

  if (r2Client && r2Config) {
    try {
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
      return await getSignedUrl(
        r2Client,
        new GetObjectCommand({ Bucket: r2Config.privateBucket || r2Config.bucket, Key: key }),
        { expiresIn },
      );
    } catch (err) {
      console.error('[storage] presign hiba:', err.message);
      return null;
    }
  }

  // Disk fallback (dev/teszt): a statikusan kiszolgált private mappa útja.
  // Élesben ez az ág nem fut (ott R2 van); devben elfogadott kompromisszum.
  return `/uploads/private/${path.basename(key)}`;
}

/**
 * Igazat ad vissza, ha R2 aktív. A hívó tudni akarja, perzisztens-e.
 */
function isPersistent() {
  return r2Client !== null;
}

/**
 * Fájl törlése a tárolóból (R2 vagy lokális disk). A `saveFile` által
 * visszaadott URL-t várja. Idempotens, soha nem dob — a hívó (pl. a KYC
 * retenció) csak naplózza, ha nem sikerül.
 * @param {string} url
 * @returns {Promise<boolean>} true, ha a törlés (vagy a "nincs mit törölni") rendben lezajlott
 */
async function deleteFile(url) {
  if (!url) return false;

  // Privát fájl: `private:<kulcs>` — a privát bucketből (vagy diskről) törlünk
  if (url.startsWith('private:')) {
    const key = url.slice('private:'.length);
    if (!key) return false;
    if (r2Client && r2Config) {
      try {
        const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
        await r2Client.send(new DeleteObjectCommand({
          Bucket: r2Config.privateBucket || r2Config.bucket,
          Key: key,
        }));
        return true;
      } catch (err) {
        console.error('[storage] R2 privát törlés hiba:', err.message);
        return false;
      }
    }
    try {
      const filepath = path.join(PRIVATE_DIR, path.basename(key));
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      return true;
    } catch (err) {
      console.error('[storage] disk privát törlés hiba:', err.message);
      return false;
    }
  }

  // R2 objektum: a publikus URL prefix után jön a kulcs (fájlnév)
  if (r2Client && r2Config && url.startsWith(`${r2Config.publicUrl}/`)) {
    const key = url.slice(r2Config.publicUrl.length + 1);
    if (!key) return false;
    try {
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      await r2Client.send(new DeleteObjectCommand({ Bucket: r2Config.bucket, Key: key }));
      return true;
    } catch (err) {
      console.error('[storage] R2 törlés hiba:', err.message);
      return false;
    }
  }

  // Lokális disk: /uploads/<fájl>
  if (url.startsWith('/uploads/')) {
    try {
      const filepath = path.join(UPLOADS_DIR, path.basename(url));
      if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
      return true;
    } catch (err) {
      console.error('[storage] disk törlés hiba:', err.message);
      return false;
    }
  }

  // data: URL vagy ismeretlen formátum — nincs külön objektum, amit törölni kell
  return true;
}

module.exports = { saveFile, savePrivateFile, getSignedPrivateUrl, isPersistent, deleteFile };
