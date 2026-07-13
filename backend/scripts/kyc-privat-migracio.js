// KYC-fotók átköltöztetése a PUBLIKUS bucketből a PRIVÁT bucketbe
// (2026-07-13, biztonsági audit). Egyszeri migráció, prod ellen.
//
// Mit csinál minden kyc_documents sorra, aminek file_url-je publikus R2 URL:
//   1. letölti az objektumot a publikus bucketből
//   2. feltölti a privát bucketbe (kyc/<fájlnév> kulccsal)
//   3. a sorban file_url = 'private:kyc/<fájlnév>'
//   4. törli az objektumot a publikus bucketből
// Idempotens: a már 'private:'-os sorokat kihagyja. A '/uploads/'-os
// (disk-fallback-es, valszeg elveszett) sorokat csak listázza.
//
// Futtatás:  cd backend && node scripts/kyc-privat-migracio.js
// Env: DATABASE_URL + R2_* + R2_PRIVATE_BUCKET_NAME (a backend/.env-ből
// a DB jön; az R2 kulcsokat a Railway Variables-ből kell ide másolni
// futtatáskor, pl. R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... node scripts/...)
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  const {
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME, R2_PUBLIC_URL, R2_PRIVATE_BUCKET_NAME,
  } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !R2_PUBLIC_URL || !R2_PRIVATE_BUCKET_NAME) {
    console.error('Hiányzó R2 env — kell: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL, R2_PRIVATE_BUCKET_NAME');
    process.exit(1);
  }
  const publicUrl = R2_PUBLIC_URL.trim().replace(/[<>]/g, '').replace(/\/$/, '');

  const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  const { rows } = await pool.query(
    `SELECT id, user_id, doc_type, file_url FROM kyc_documents ORDER BY created_at`,
  );
  console.log(`\n════════ KYC PRIVÁT MIGRÁCIÓ — ${rows.length} dokumentum ════════\n`);

  let moved = 0, skippedPrivate = 0, skippedDisk = 0, failed = 0;
  for (const r of rows) {
    if (!r.file_url) { skippedDisk++; continue; }
    if (r.file_url.startsWith('private:')) { skippedPrivate++; continue; }
    if (!r.file_url.startsWith(`${publicUrl}/`)) {
      console.log(`   ⏭️  nem publikus R2 URL, kihagyva (${r.id}): ${r.file_url.slice(0, 60)}`);
      skippedDisk++;
      continue;
    }
    const oldKey = r.file_url.slice(publicUrl.length + 1);
    const newKey = `kyc/${oldKey.split('/').pop()}`;
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: oldKey }));
      const body = Buffer.from(await obj.Body.transformToByteArray());
      await s3.send(new PutObjectCommand({
        Bucket: R2_PRIVATE_BUCKET_NAME,
        Key: newKey,
        Body: body,
        ContentType: obj.ContentType || 'image/jpeg',
        CacheControl: 'private, no-store',
      }));
      await pool.query(`UPDATE kyc_documents SET file_url = $1 WHERE id = $2`, [`private:${newKey}`, r.id]);
      await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: oldKey }));
      moved++;
      console.log(`   ✅ ${r.doc_type} (${r.id}) → private:${newKey}`);
    } catch (e) {
      failed++;
      console.error(`   ❌ ${r.id}: ${e.message}`);
    }
  }

  console.log(`\n════════ KÉSZ: ${moved} átköltöztetve, ${skippedPrivate} már privát, ${skippedDisk} kihagyva, ${failed} hiba ════════\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
})();
