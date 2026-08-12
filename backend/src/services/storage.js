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
      // ⚠️ 2026-08-09 (audit 3. kör): ÉLESBEN NINCS csendes disk-fallback.
      // A privát fájl itt egy SZEMÉLYI IGAZOLVÁNY fotója. A lokális disk
      // Railway-en ráadásul nem perzisztens, és a fájl a webszerver
      // uploads-fájáig kerülne — a legrosszabb hely egy okmánynak. Inkább
      // hibázzon a feltöltés (a user újrapróbálja), mint hogy egy R2-kiesés
      // némán a webgyökérbe tegye az okmányt.
      console.error('[storage] R2 privát upload hiba:', err.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('A dokumentum feltöltése átmenetileg nem sikerült. Kérjük, próbáld újra néhány perc múlva.');
      }
      console.error('[storage] (nem-éles futás) → disk fallback');
    }
  }

  // Disk fallback — CSAK dev/teszt. A fájl a private mappába kerül, amit a
  // statikus kiszolgálás NEM ad ki (index.js guard); olvasni az aláírt
  // /private-files/ úton lehet (lásd signPrivateDiskUrl).
  const filepath = path.join(PRIVATE_DIR, path.basename(key));
  fs.writeFileSync(filepath, buffer);
  return `private:${key}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Disk-fallback privát olvasás: rövid életű, ALÁÍRT URL (a presigned R2-URL
// megfelelője). Korábban a fallback egyszerűen `/uploads/private/<fájl>`-t
// adott vissza, amit az express.static bárkinek kiszolgált — hitelesítés
// nélkül, lejárat nélkül. A HMAC-aláírás ugyanazt a garanciát adja, mint az
// R2 presign: csak a szerver által kiadott link működik, és csak ideig.
// ─────────────────────────────────────────────────────────────────────────
const PRIVATE_NAME_RE = /^[a-f0-9]{32}\.[a-z0-9]{1,6}$/;

function privateDiskSignature(name, exp) {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev-secret')
    .update(`${name}.${exp}`)
    .digest('hex')
    .slice(0, 32);
}

function signPrivateDiskUrl(key, expiresIn = 600) {
  const name = path.basename(key);
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  return `/private-files/${name}?exp=${exp}&sig=${privateDiskSignature(name, exp)}`;
}

/**
 * Az aláírt privát-fájl kérés ellenőrzése + a lemezen lévő fájl útja.
 * @returns {{ok: true, filepath: string} | {ok: false, reason: string}}
 */
function resolvePrivateDiskFile(name, exp, sig) {
  if (typeof name !== 'string' || !PRIVATE_NAME_RE.test(name)) return { ok: false, reason: 'invalid_name' };
  const expNum = Number(exp);
  // Hiányzó/értelmezhetetlen lejárat = érvénytelen link (404), nem „lejárt"
  // (410) — a 410 azt üzenné, hogy létezett ilyen link, csak elavult.
  if (exp === undefined || exp === null || exp === '' || !Number.isFinite(expNum)) {
    return { ok: false, reason: 'invalid_exp' };
  }
  if (expNum < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };
  const expected = privateDiskSignature(name, String(exp));
  // ⚠️ ALAK-ellenőrzés, nem hossz-ellenőrzés (2026-08-09, audit 2. kör).
  // A `sig.length` KARAKTERBEN számol, a `timingSafeEqual` viszont BÁJTBAN:
  // 32 többbájtos karakter (pl. „éééé…") átment az első kapun, majd a
  // `timingSafeEqual` RangeError-t dobott → 500 „Szerverhiba" hitelesítés
  // nélkül, felesleges Sentry-riasztással. Az aláírás mindig 32 hex jegy,
  // ezért a mintaellenőrzés egyszerre szigorúbb és biztonságos.
  if (typeof sig !== 'string' || !/^[a-f0-9]{32}$/.test(sig)) return { ok: false, reason: 'bad_signature' };
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) {
    return { ok: false, reason: 'bad_signature' };
  }
  const filepath = path.join(PRIVATE_DIR, name);
  if (!filepath.startsWith(PRIVATE_DIR) || !fs.existsSync(filepath)) return { ok: false, reason: 'not_found' };
  return { ok: true, filepath };
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

  // Disk fallback (dev/teszt): ALÁÍRT, lejáró út — nem a statikus mappa.
  return signPrivateDiskUrl(key, expiresIn);
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

  // ⚠️ FAIL-CLOSED AZ ISMERETLEN TÁVOLI URL-RE (2026-08-12, 11. mérés A3).
  //
  // Korábban MINDEN fel nem ismert alak `true`-t kapott („nincs mit törölni").
  // A `data:` URL-re és a relatív útra ez helyes — egy `http(s)://` URL-re
  // viszont VÉGZETES: ha az R2_PUBLIC_URL megváltozik (saját domainre váltás)
  // vagy egy deploynál eltér, a prefix-illesztés elhasal, a függvény `true`-t
  // ad, és a napi retenciós kör TÖRLI AZ EGYETLEN MUTATÓT minden régi fotóról.
  // Az objektumok VÉGLEGESEN a PUBLIKUS bucketben maradnak — feladói
  // lakásbelső, kézbesítési bizonyítékfotók —, `beragadt = 0`, riasztás nincs.
  //
  // Ez a CSENDES, TÖMEGES változata annak az árva-fájl osztálynak, amit a
  // 8. körben lezártunk. A hívók (retention.js, kyc.js) `false` esetén
  // MEGTARTJÁK a DB-sort és riasztanak — pontosan ezt akarjuk.
  if (/^https?:\/\//i.test(url)) {
    console.error(`[storage] ISMERETLEN távoli URL, nem tudom kulcsra képezni: ${String(url).slice(0, 120)}`);
    try {
      require('@sentry/node').captureMessage(
        '[storage] deleteFile: ismeretlen távoli URL — a mutatót MEGTARTJUK (R2_PUBLIC_URL eltérés?)',
        'error',
      );
    } catch { /* a Sentry hiánya ne akassza meg a kört */ }
    return false;
  }

  // data: URL vagy relatív út — nincs külön objektum, amit törölni kell.
  return true;
}

module.exports = {
  saveFile, savePrivateFile, getSignedPrivateUrl, isPersistent, deleteFile,
  signPrivateDiskUrl, resolvePrivateDiskFile,
};
