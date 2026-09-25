// Kizárólag olvasó, lapozható leltár a korábban közzétett avatar/listing
// képekhez. Nincs dotenv, PUT, DELETE, DB-módosítás vagy --apply üzemmód.
const crypto = require('crypto');
const sharp = require('sharp');
const { sanitizePublicImage } = require('../src/services/publicImage');
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

function createSourceReader({ client, bucket, publicUrl }) {
  const base = new URL(publicUrl);
  const prefix = `${base.href.replace(/\/$/, '')}/`;
  return async url => {
    if (url.startsWith('data:')) {
      if (url.length > MAX_SOURCE_BYTES * 4 / 3 + 128) throw new Error('SOURCE_TOO_LARGE');
      const match = /^data:image\/(?:jpeg|png|webp|gif|avif|heic);base64,([A-Za-z0-9+/=]+)$/.exec(url);
      if (!match) throw new Error('UNSUPPORTED_SOURCE');
      return Buffer.from(match[1], 'base64');
    }
    // Nem fetch-elünk DB-ből kapott tetszőleges URL-t, még átirányítva sem.
    // Csak a beállított bucket egyszerű, saját nyilvános kulcsa olvasható.
    if (!url.startsWith(prefix)) throw new Error('UNSUPPORTED_SOURCE');
    const key = url.slice(prefix.length);
    if (!/^[a-f0-9]{32}\.[a-z0-9]{1,6}$/.test(key)) throw new Error('UNSUPPORTED_SOURCE');
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const controller = new AbortController(); let body;
    const timer = setTimeout(() => { controller.abort(); body?.destroy?.(new Error('SOURCE_TIMEOUT')); }, 10_000);
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: controller.signal });
      body = result.Body;
      if (!body || result.ContentLength > MAX_SOURCE_BYTES) throw new Error('SOURCE_TOO_LARGE');
      const chunks = []; let size = 0;
      for await (const chunk of body) {
        size += chunk.length;
        if (size > MAX_SOURCE_BYTES) throw new Error('SOURCE_TOO_LARGE');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } finally { clearTimeout(timer); body?.destroy?.(); }
  };
}

async function scanPublicImages({ db, readImage, kind = null, after = null, limit = 50 }) {
  if (kind !== null && !['avatar', 'listing'].includes(kind)) throw new Error('INVALID_KIND');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_LIMIT');
  const match = after?.match(/^(avatar|listing):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (after && !match) throw new Error('INVALID_CURSOR');
  const { rows } = await db.query(`SELECT * FROM (
      SELECT 'avatar'::text AS kind, id, id AS owner_id, avatar_url AS url FROM users WHERE avatar_url IS NOT NULL
      UNION ALL
      SELECT 'listing'::text, id, uploader_id, url FROM photos WHERE kind = 'listing' AND url IS NOT NULL
    ) images WHERE ($1::text IS NULL OR kind = $1)
      AND ($2::text IS NULL OR (kind, id) > ($2, $3::uuid))
    ORDER BY kind, id LIMIT $4`, [kind, match?.[1] || null, match?.[2] || null, limit]);
  const results = [];
  for (const row of rows) {
    const result = { kind: row.kind, id: row.id,
      source_hash: crypto.createHash('sha256').update(row.url).digest('hex') };
    // Az URL csak a 0600-as leltárba kerül; a data URL maga a kép, azt nem írjuk ki.
    if (/^https?:\/\//.test(row.url)) result.source_url = row.url;
    const references = await db.query(`SELECT EXISTS (
      SELECT 1 FROM photos WHERE url = $1 AND kind <> 'listing'
      UNION ALL SELECT 1 FROM disputes WHERE evidence_url = $1
    ) AS protected`, [row.url]);
    if (references.rows[0].protected) {
      results.push({ ...result, action: 'manual_review_evidence_reference' });
      continue;
    }
    try {
      const buffer = await readImage(row.url);
      const metadata = await sharp(buffer, { animated: true, limitInputPixels: 64_000_000 }).metadata();
      // A leltár sem ír ki GPS-t, nevet vagy más metaadatértéket.
      result.metadata_present = !!(metadata.exif || metadata.iptc || metadata.xmp || metadata.icc || metadata.comments?.length);
      const sanitized = await sanitizePublicImage({ buffer });
      results.push({ ...result, action: result.metadata_present ? 'sanitize' : 'no_metadata_detected',
        source_bytes: buffer.length, output_bytes: sanitized.buffer.length, output_type: sanitized.mimetype });
    } catch (err) {
      const known = ['UNSUPPORTED_SOURCE', 'SOURCE_TOO_LARGE', 'SOURCE_TIMEOUT', 'INVALID_PUBLIC_IMAGE'];
      results.push({ ...result, action: 'manual_review_unreadable',
        reason: known.includes(err.code || err.message) ? err.code || err.message : 'READ_FAILED' });
    }
  }
  return { dry_run: true, scanned: rows.length,
    next_cursor: rows.length ? `${rows.at(-1).kind}:${rows.at(-1).id}` : null, results };
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('Csak olvasás: node scripts/public-image-dry-run.js --out /biztonsagos/leltar.json [--kind avatar|listing] [--limit 50] [--after listing:UUID]');
    console.log('Explicit DATABASE_URL és R2_* env szükséges. .env nem töltődik be. Nincs --apply.');
    return;
  }
  const allowed = new Set(['--out', '--kind', '--limit', '--after']); const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('INVALID_ARGUMENT');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.out) throw new Error('--out szükséges (új, 0600 jogosultságú leltárfájl)');
  for (const key of ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL']) {
    if (!process.env[key]) throw new Error(`Hiányzó explicit env: ${key}`);
  }
  const fs = require('fs'); const fd = fs.openSync(options.out, 'wx', 0o600);
  const { S3Client } = require('@aws-sdk/client-s3');
  const client = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const db = require('../src/db');
  try {
    const result = await scanPublicImages({ db,
      readImage: createSourceReader({ client, bucket: process.env.R2_BUCKET_NAME, publicUrl: process.env.R2_PUBLIC_URL }),
      kind: options.kind || null, after: options.after || null, limit: options.limit ? Number(options.limit) : 50 });
    fs.writeFileSync(fd, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ dry_run: true, scanned: result.scanned, next_cursor: result.next_cursor,
      actions: result.results.reduce((counts, row) => ({ ...counts, [row.action]: (counts[row.action] || 0) + 1 }), {}) }));
  } finally { fs.closeSync(fd); client.destroy(); await db.pool.end(); }
}

if (require.main === module) main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { scanPublicImages, createSourceReader };
