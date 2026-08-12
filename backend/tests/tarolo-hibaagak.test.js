// =====================================================================
//  TÁROLÓ (R2): AMI AKKOR TÖRTÉNIK, HA A TÁROLÁS ELROMLIK (2026-08-12)
//
//  ⚠️ 57%-OS ELÁGAZÁS-LEFEDETTSÉGEN ÁLLT — és ami fedetlen volt, az KIZÁRÓLAG
//  az R2-mód. A teszt-környezet ugyanis kiüríti az R2_* env-eket, tehát MINDEN
//  eddigi teszt a DISK-fallbacken futott. Vagyis pontosan az az ág volt
//  méretlen, ami ÉLESBEN az egyetlen valóban használt út.
//
//  Amit ez a fájl őriz:
//   1. A SZEMÉLYI IGAZOLVÁNY sosem eshet csendben a webgyökérbe. Élesben egy
//      R2-kiesésnél a feltöltés inkább HIBÁZZON (2026-08-09 audit döntése).
//   2. A privát fájl a PRIVÁT bucketbe megy, és csak lejáró, aláírt linkkel
//      olvasható.
//   3. A `deleteFile` FAIL-CLOSED egy fel nem ismert távoli URL-re (2026-08-12,
//      11. mérés): ha `true`-t adna, a napi retenciós kör letörölné az EGYETLEN
//      mutatót minden régi fotóról, és az objektumok örökre a PUBLIKUS
//      bucketben maradnának — némán, riasztás nélkül.
//   4. Az aláírt disk-link nem törhető meg többbájtos aláírással (a korábbi
//      `timingSafeEqual` RangeError → 500 hitelesítés nélkül).
//
//  ⚠️ SOHA NEM ÉR EL VALÓDI BUCKETET. Az AWS SDK-t a CJS-cache-be tett hamis
//  modul helyettesíti, a hitelesítő adatok nyilvánvalóan hamisak, és minden
//  R2-módú teszt ELLENŐRZI, hogy a hamis kliens kapta meg a parancsot.
// =====================================================================
import {
  describe, it, expect, beforeEach, afterEach, afterAll, vi,
} from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Module = require('module');
const crypto = require('crypto');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const PRIVATE_DIR = path.join(UPLOADS_DIR, 'private');

const S3_UT = require.resolve('@aws-sdk/client-s3');
const PRESIGN_UT = require.resolve('@aws-sdk/s3-request-presigner');
const TAROLO_UT = require.resolve('../src/services/storage');

const EREDETI = {
  s3: require.cache[S3_UT],
  presign: require.cache[PRESIGN_UT],
  tarolo: require.cache[TAROLO_UT],
};
const R2_KULCSOK = [
  'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'R2_PRIVATE_BUCKET_NAME',
];
const EREDETI_ENV = Object.fromEntries(R2_KULCSOK.map((k) => [k, process.env[k]]));

/** Napló: mit kapott a hamis S3-kliens. */
let naplo;

function hamisS3Modul() {
  class S3Client {
    constructor(cfg) { naplo.klienskonfig = cfg; }

    async send(cmd) {
      naplo.parancsok.push({ tipus: cmd.__tipus, ...cmd.input });
      if (naplo.kuldesHiba) throw new Error(naplo.kuldesHiba);
      return { ok: true };
    }
  }
  const parancs = (tipus) => class {
    constructor(input) { this.__tipus = tipus; this.input = input; }
  };
  const m = new Module(S3_UT, null);
  m.filename = S3_UT;
  m.loaded = true;
  m.exports = {
    S3Client,
    PutObjectCommand: parancs('put'),
    DeleteObjectCommand: parancs('delete'),
    GetObjectCommand: parancs('get'),
  };
  require.cache[S3_UT] = m;

  const p = new Module(PRESIGN_UT, null);
  p.filename = PRESIGN_UT;
  p.loaded = true;
  p.exports = {
    getSignedUrl: async (_kliens, cmd, opts) => {
      if (naplo.presignHiba) throw new Error(naplo.presignHiba);
      naplo.presignKeresek.push({ ...cmd.input, expiresIn: opts?.expiresIn });
      return `https://hamis-presign.example/${cmd.input.Bucket}/${cmd.input.Key}?exp=${opts?.expiresIn}`;
    },
  };
  require.cache[PRESIGN_UT] = p;
}

/** Az SDK „nincs telepítve" esete: a require destrukturálása dob. */
function hianyzoS3Modul() {
  const m = new Module(S3_UT, null);
  m.filename = S3_UT;
  m.loaded = true;
  m.exports = new Proxy({}, {
    get() { throw new Error('Cannot find module @aws-sdk/client-s3'); },
  });
  require.cache[S3_UT] = m;
}

/**
 * Friss tároló-modul a kívánt konfigurációval.
 *  - `r2: false` → disk-fallback (ez az eddigi tesztek világa)
 *  - `privatBucket: false` → van R2, de nincs külön privát bucket
 *  - `sdkHianyzik: true` → az @aws-sdk require-ja dob
 */
function betoltTarolo({
  r2 = true, privatBucket = true, sdkHianyzik = false, publikusUrl = 'https://pub-teszt.r2.dev',
} = {}) {
  naplo = {
    klienskonfig: null, parancsok: [], presignKeresek: [], kuldesHiba: null, presignHiba: null,
  };
  if (sdkHianyzik) hianyzoS3Modul(); else hamisS3Modul();

  if (r2) {
    // ⚠️ Szándékosan nem létező fiók/kulcs: ha a hamis SDK valaha kiesne, a
    // valódi kliens sem érne el semmilyen valóságos bucketet.
    process.env.R2_ACCOUNT_ID = 'teszt-nem-letezo-fiok';
    process.env.R2_ACCESS_KEY_ID = 'teszt-hozzaferesi-kulcs';
    process.env.R2_SECRET_ACCESS_KEY = 'teszt-titkos-kulcs';
    process.env.R2_BUCKET_NAME = 'teszt-publikus-bucket';
    process.env.R2_PUBLIC_URL = publikusUrl;
    process.env.R2_PRIVATE_BUCKET_NAME = privatBucket ? 'teszt-privat-bucket' : '';
  } else {
    for (const k of R2_KULCSOK) process.env[k] = '';
  }
  delete require.cache[TAROLO_UT];
  return require(TAROLO_UT);
}

const BAJTOK = Buffer.from('teszt-fajl-tartalom');

let letrehozottFajlok;
beforeEach(() => { letrehozottFajlok = []; });

afterEach(() => {
  vi.restoreAllMocks();
  // A disk-módban keletkezett fájlokat takarítjuk.
  for (const f of letrehozottFajlok) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* nem baj */ }
  }
});

afterAll(() => {
  for (const [k, v] of Object.entries(EREDETI_ENV)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  if (EREDETI.s3) require.cache[S3_UT] = EREDETI.s3; else delete require.cache[S3_UT];
  if (EREDETI.presign) require.cache[PRESIGN_UT] = EREDETI.presign; else delete require.cache[PRESIGN_UT];
  if (EREDETI.tarolo) require.cache[TAROLO_UT] = EREDETI.tarolo; else delete require.cache[TAROLO_UT];
});

// =====================================================================
//  1) AZ R2 BEKAPCSOLÁSA — mikor NEM aktiválódik
// =====================================================================
describe('R2 inicializálás', () => {
  it('hiányzó env-nél disk-módba esik (nem próbál félkonfigurációval feltölteni)', () => {
    const t = betoltTarolo({ r2: false });
    expect(
      t.isPersistent(),
      'R2-kulcsok nélkül is perzisztensnek mondtuk magunkat — a hívó azt hinné, '
      + 'hogy a fájl túléli a következő deployt (Railway-en NEM éli túl)',
    ).toBe(false);
  });

  it('EGYETLEN hiányzó env is disk-módot jelent (nincs fél-konfiguráció)', () => {
    for (const hianyzo of R2_KULCSOK.filter((k) => k !== 'R2_PRIVATE_BUCKET_NAME')) {
      const t = betoltTarolo({ r2: true });
      process.env[hianyzo] = '';
      delete require.cache[TAROLO_UT];
      const ujra = require(TAROLO_UT);
      expect(
        ujra.isPersistent(),
        `a(z) ${hianyzo} hiánya ellenére R2-módba kapcsoltunk — egy hiányos env `
        + 'félkész klienst hozna létre, ami minden feltöltésnél elhasal',
      ).toBe(false);
      void t;
    }
  });

  it('a publikus URL-t megtisztítja a rossz beillesztéstől (<, >, záró /)', async () => {
    const t = betoltTarolo({ r2: true, publikusUrl: '<https://files.gofuvar.hu/>' });
    const url = await t.saveFile(BAJTOK, 'kep.jpg', 'image/jpeg');
    expect(
      url,
      'a rosszul beillesztett env-ből (< > záró perjel) törött publikus URL lett — '
      + 'minden feltöltött kép hivatkozása elromlana',
    ).toMatch(/^https:\/\/files\.gofuvar\.hu\/[0-9a-f]{32}\.jpg$/);
  });

  it('ha az AWS SDK nem tölthető be, a boot NEM törik el (disk-fallback)', () => {
    const t = betoltTarolo({ r2: true, sdkHianyzik: true });
    expect(
      t.isPersistent(),
      'egy hiányzó/sérült @aws-sdk csomag esetén nem estünk vissza diskre — '
      + 'a teljes backend boot-ja elszállna egy csomag-problémán',
    ).toBe(false);
  });
});

// =====================================================================
//  2) PUBLIKUS FELTÖLTÉS
// =====================================================================
describe('saveFile (publikus bucket)', () => {
  it('R2-módban a publikus URL-t adja vissza, és tényleg feltölt', async () => {
    const t = betoltTarolo();
    const url = await t.saveFile(BAJTOK, 'fuvar.png', 'image/png');
    expect(url).toMatch(/^https:\/\/pub-teszt\.r2\.dev\/[0-9a-f]{32}\.png$/);

    const put = naplo.parancsok.find((p) => p.tipus === 'put');
    expect(put, 'nem indult feltöltés az R2 felé').toBeTruthy();
    expect(put.Bucket, 'a publikus fotó nem a publikus bucketbe ment').toBe('teszt-publikus-bucket');
    expect(put.ContentType, 'a MIME-típus elveszett — a böngésző letöltésként kezelné a képet').toBe('image/png');
    expect(
      put.CacheControl,
      'a publikus képnél elveszett a hosszú cache — hash-nevű, immutable fájlokról van szó',
    ).toMatch(/immutable/);
  });

  it('a fájlnév SOSEM a felhasználótól jön (véletlen hex + szűrt kiterjesztés)', async () => {
    const t = betoltTarolo();
    const esetek = [
      ['../../etc/passwd', 'jpg'],          // path traversal
      ['kep.JPG', 'jpg'],                    // nagybetűs
      ['nincs-kiterjesztes', 'jpg'],         // nincs pont
      ['kep.tar.gz', 'gz'],                  // többszörös pont
      ['kep.<script>', 'jpg'],               // szemét kiterjesztés
      ['kep.abcdefghij', 'jpg'],             // túl hosszú kiterjesztés
      [null, 'jpg'],
    ];
    for (const [nev, vartExt] of esetek) {
      const url = await t.saveFile(BAJTOK, nev, 'image/jpeg');
      expect(
        url,
        `a(z) "${nev}" fájlnévből nem tiszta, véletlen kulcs lett — a felhasználó `
        + 'által megadott név NEM kerülhet a tároló-kulcsba (path traversal / XSS)',
      ).toMatch(new RegExp(`/[0-9a-f]{32}\\.${vartExt}$`));
    }
  });

  it('hiányzó MIME-típusnál semleges ContentType megy ki', async () => {
    const t = betoltTarolo();
    await t.saveFile(BAJTOK, 'x.jpg', null);
    expect(
      naplo.parancsok[0].ContentType,
      'MIME nélkül üres/undefined ContentType ment az R2-nek',
    ).toBe('application/octet-stream');
  });

  it('R2-hiba esetén NEM dob (a fuvar-folyamat nem akadhat el)', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'R2 503';
    let url;
    await expect(
      (async () => { url = await t.saveFile(BAJTOK, 'x.jpg', 'image/jpeg'); })(),
      'egy R2-kiesés kivételként jött vissza — a fotó-feltöltés végpontja '
      + '500-zal szállna el, és a szállító nem tudná lezárni a fuvart',
    ).resolves.not.toThrow();
    expect(url, 'a hibaág után nem kaptunk semmilyen URL-t').toBeTruthy();
    letrehozottFajlok.push(path.join(UPLOADS_DIR, path.basename(url)));
  });

  it('disk-módban relatív /uploads/ utat ad, és a fájl tényleg a lemezen van', async () => {
    const t = betoltTarolo({ r2: false });
    const url = await t.saveFile(BAJTOK, 'x.jpg', 'image/jpeg');
    expect(url).toMatch(/^\/uploads\/[0-9a-f]{32}\.jpg$/);
    const fp = path.join(UPLOADS_DIR, path.basename(url));
    letrehozottFajlok.push(fp);
    expect(fs.existsSync(fp), 'a disk-mentés nem írt fájlt').toBe(true);
    expect(fs.readFileSync(fp).equals(BAJTOK), 'a lemezre írt tartalom nem egyezik').toBe(true);
  });
});

// =====================================================================
//  3) PRIVÁT (KYC) FELTÖLTÉS — itt egy SZEMÉLYI IGAZOLVÁNY fotója utazik
// =====================================================================
describe('savePrivateFile (KYC okmány)', () => {
  it('a PRIVÁT bucketbe megy, cache nélkül, és nem ad publikus URL-t', async () => {
    const t = betoltTarolo();
    const jelolo = await t.savePrivateFile(BAJTOK, 'szemelyi.jpg', 'image/jpeg');

    expect(jelolo).toMatch(/^private:kyc\/[0-9a-f]{32}\.jpg$/);
    expect(jelolo, 'az okmány jelölője http URL lett — az bárhonnan lehívható').not.toMatch(/^https?:/);

    const put = naplo.parancsok[0];
    expect(
      put.Bucket,
      'A SZEMÉLYI IGAZOLVÁNY A PUBLIKUS BUCKETBE MENT. A privát bucket be van '
      + 'állítva, mégis a publikusat választottuk — az okmány kiszivárogna.',
    ).toBe('teszt-privat-bucket');
    expect(
      put.CacheControl,
      'az okmány cache-elhetőként ment ki — CDN/proxy tárolhatná az igazolványt',
    ).toMatch(/no-store/);
  });

  it('privát bucket hiányában a publikusba esik vissza, de kyc/ prefixszel', async () => {
    const t = betoltTarolo({ privatBucket: false });
    const jelolo = await t.savePrivateFile(BAJTOK, 'szemelyi.jpg', 'image/jpeg');
    expect(naplo.parancsok[0].Bucket).toBe('teszt-publikus-bucket');
    expect(
      naplo.parancsok[0].Key,
      'a visszaesésnél elveszett a kyc/ prefix — az okmány a fuvarfotók közé '
      + 'keveredne, és a takarító szkriptek sem találnák meg',
    ).toMatch(/^kyc\//);
    expect(jelolo).toMatch(/^private:kyc\//);
  });

  it('ÉLESBEN egy R2-hiba HIBÁT dob — nincs csendes disk-fallback', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'R2 kiesés';
    const eredetiEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(
        t.savePrivateFile(BAJTOK, 'szemelyi.jpg', 'image/jpeg'),
        'ÉLESBEN AZ R2-KIESÉS CSENDBEN A LEMEZRE TETTE A SZEMÉLYI IGAZOLVÁNYT.\n\n'
        + 'A Railway-lemez (a) nem perzisztens, (b) a webszerver uploads-fája — a '
        + 'legrosszabb hely egy okmánynak. A 2026-08-09-i audit döntése: inkább '
        + 'hibázzon a feltöltés, a user újrapróbálja.',
      ).rejects.toThrow();
    } finally {
      process.env.NODE_ENV = eredetiEnv;
    }
  });

  it('a dobott hiba a FELHASZNÁLÓNAK szól, nem a belső R2-hibát szivárogtatja', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'AccessDenied: bucket teszt-privat-bucket, key AKIA123';
    const eredetiEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await t.savePrivateFile(BAJTOK, 'sz.jpg', 'image/jpeg');
      throw new Error('nem dobott');
    } catch (err) {
      expect(
        err.message,
        'a nyers R2-hibaüzenet (bucket-név, hitelesítési részlet) került a '
        + 'felhasználóhoz — belső infrastruktúra-részlet sosem mehet ki',
      ).not.toMatch(/AccessDenied|AKIA|bucket/i);
      expect(err.message).toMatch(/próbáld újra/i);
    } finally {
      process.env.NODE_ENV = eredetiEnv;
    }
  });

  it('dev/teszt módban az R2-hiba után lemezre esik (hogy fejleszthető maradjon)', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'R2 kiesés';
    const jelolo = await t.savePrivateFile(BAJTOK, 'sz.jpg', 'image/jpeg');
    const fp = path.join(PRIVATE_DIR, path.basename(jelolo.slice('private:'.length)));
    letrehozottFajlok.push(fp);
    expect(fs.existsSync(fp), 'a nem-éles disk-fallback nem írt fájlt').toBe(true);
    expect(
      fs.existsSync(path.join(UPLOADS_DIR, path.basename(fp))),
      'az okmány a PUBLIKUS uploads gyökerébe került, nem a private mappába — '
      + 'onnan az express.static kiszolgálná',
    ).toBe(false);
  });
});

// =====================================================================
//  4) ALÁÍRT OLVASÁS
// =====================================================================
describe('getSignedPrivateUrl', () => {
  it('R2-módban presigned URL-t ad a PRIVÁT bucketre, lejárattal', async () => {
    const t = betoltTarolo();
    const url = await t.getSignedPrivateUrl('private:kyc/abc.jpg', 120);
    expect(naplo.presignKeresek[0].Bucket, 'a presign a rossz bucketre készült').toBe('teszt-privat-bucket');
    expect(naplo.presignKeresek[0].Key).toBe('kyc/abc.jpg');
    expect(
      naplo.presignKeresek[0].expiresIn,
      'a kért lejárat nem jutott át — egy „örök" aláírt link az okmányt '
      + 'határidő nélkül olvashatóvá tenné',
    ).toBe(120);
    expect(url).toContain('hamis-presign');
  });

  it('presign-hiba esetén null-t ad — sosem a nyers kulcsot', async () => {
    const t = betoltTarolo();
    naplo.presignHiba = 'presign elszállt';
    const url = await t.getSignedPrivateUrl('private:kyc/abc.jpg');
    expect(
      url,
      'presign-hibánál nem null jött vissza — ha a nyers kulcs vagy egy '
      + 'aláíratlan URL szivárogna ki, az okmány védelme megszűnne',
    ).toBeNull();
  });

  it('nem-privát vagy üres bemenetre nem „ír alá" semmit', async () => {
    const t = betoltTarolo();
    for (const be of ['https://pub-teszt.r2.dev/x.jpg', '/uploads/x.jpg', 'private:', '', null, undefined]) {
      expect(
        await t.getSignedPrivateUrl(be),
        `a(z) ${JSON.stringify(be)} bemenetre aláírt linket adtunk — a függvény `
        + 'csak `private:<kulcs>` alakot ismerhet el',
      ).toBeNull();
    }
    expect(naplo.presignKeresek, 'érvénytelen bemenetre is indult presign-kérés').toEqual([]);
  });

  it('disk-módban aláírt, LEJÁRÓ utat ad — nem a statikus /uploads/private utat', async () => {
    const t = betoltTarolo({ r2: false });
    const url = await t.getSignedPrivateUrl('private:kyc/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg', 300);
    expect(
      url,
      'a disk-fallback a statikus uploads-utat adta vissza — azt az '
      + 'express.static bárkinek kiszolgálná, hitelesítés és lejárat nélkül',
    ).toMatch(/^\/private-files\/[0-9a-f]{32}\.jpg\?exp=\d+&sig=[0-9a-f]{32}$/);
  });
});

// =====================================================================
//  5) AZ ALÁÍRT DISK-LINK ELLENŐRZÉSE (a /private-files/ kapu)
// =====================================================================
describe('resolvePrivateDiskFile — a KYC-fájl aláírt kapuja', () => {
  const t = () => betoltTarolo({ r2: false });

  /** Valódi, létező privát fájl + a hozzá tartozó érvényes link darabjai. */
  async function ervenyesLink(tarolo) {
    const jelolo = await tarolo.savePrivateFile(BAJTOK, 'sz.jpg', 'image/jpeg');
    const nev = path.basename(jelolo.slice('private:'.length));
    letrehozottFajlok.push(path.join(PRIVATE_DIR, nev));
    const url = await tarolo.getSignedPrivateUrl(jelolo, 600);
    const q = new URLSearchParams(url.split('?')[1]);
    return { nev, exp: q.get('exp'), sig: q.get('sig') };
  }

  it('érvényes aláírással megnyílik a fájl', async () => {
    const tarolo = t();
    const { nev, exp, sig } = await ervenyesLink(tarolo);
    const r = tarolo.resolvePrivateDiskFile(nev, exp, sig);
    expect(r.ok, `a saját magunk által aláírt link nem nyílt meg (${r.reason})`).toBe(true);
    expect(r.filepath.startsWith(PRIVATE_DIR)).toBe(true);
  });

  it('egyetlen karakter az aláírásban → elutasítás', async () => {
    const tarolo = t();
    const { nev, exp, sig } = await ervenyesLink(tarolo);
    const rontott = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(
      tarolo.resolvePrivateDiskFile(nev, exp, rontott).ok,
      'HAMISÍTOTT ALÁÍRÁSSAL MEGNYÍLT A KYC-FÁJL — az aláírás-ellenőrzés nem véd',
    ).toBe(false);
  });

  it('másik fájlnévre nem használható fel ugyanaz az aláírás', async () => {
    const tarolo = t();
    const a = await ervenyesLink(tarolo);
    const b = await ervenyesLink(tarolo);
    expect(
      tarolo.resolvePrivateDiskFile(b.nev, a.exp, a.sig).ok,
      'AZ ALÁÍRÁS NEM A FÁJLHOZ KÖTŐDIK — egy saját, jogos linkkel bárki '
      + 'letölthetné MÁS személyi igazolványát',
    ).toBe(false);
  });

  it('lejárt link → „expired" (a route ebből ad 410-et, nem 404-et)', async () => {
    const tarolo = t();
    const { nev } = await ervenyesLink(tarolo);
    // Múltbeli lejárat + a hozzá HELYES aláírás (a titok ugyanaz).
    const mult = String(Math.floor(Date.now() / 1000) - 10);
    const sig = crypto.createHmac('sha256', process.env.JWT_SECRET)
      .update(`${nev}.${mult}`).digest('hex').slice(0, 32);
    const r = tarolo.resolvePrivateDiskFile(nev, mult, sig);
    expect(r.ok, 'LEJÁRT ALÁÍRT LINK MÉG MINDIG MŰKÖDIK — a link időbeli korlátja elveszett').toBe(false);
    expect(r.reason).toBe('expired');
  });

  it('hiányzó/értelmezhetetlen lejárat → „invalid_exp" (nem „expired")', async () => {
    const tarolo = t();
    const { nev, sig } = await ervenyesLink(tarolo);
    for (const rossz of [undefined, null, '', 'holnap', NaN]) {
      expect(
        tarolo.resolvePrivateDiskFile(nev, rossz, sig).reason,
        `a(z) ${JSON.stringify(rossz)} lejáratot nem érvénytelennek vettük. A `
        + '„lejárt" (410) azt üzenné, hogy létezett ilyen link, csak elavult — '
        + 'ez információ-szivárgás egy sosem létezett linkről.',
      ).toBe('invalid_exp');
    }
  });

  it('path traversal a fájlnévben → elutasítás, nem fájl-olvasás', async () => {
    const tarolo = t();
    const { exp, sig } = await ervenyesLink(tarolo);
    for (const nev of [
      '../../../etc/passwd', '../uploads/masik.jpg', 'a'.repeat(32), 'AAAA.jpg',
      '../.env', 'kep.jpg', '', null, 12345, {},
    ]) {
      expect(
        tarolo.resolvePrivateDiskFile(nev, exp, sig).ok,
        `a(z) ${JSON.stringify(nev)} fájlnév átment a szűrőn — a privát mappán `
        + 'kívüli fájl (pl. .env) is olvashatóvá válhat',
      ).toBe(false);
    }
  });

  it('TÖBBBÁJTOS aláírás sem tud 500-at okozni (a régi RangeError-hiba őre)', async () => {
    const tarolo = t();
    const { nev, exp } = await ervenyesLink(tarolo);
    // 32 KARAKTER, de bájtban jóval több → a timingSafeEqual RangeError-t dobna,
    // ha a hossz-ellenőrzés karakterben számolna. Az eredmény: 500 „Szerverhiba"
    // hitelesítés nélkül, felesleges Sentry-riasztással.
    for (const sig of ['é'.repeat(32), '😀'.repeat(16), 'abc', 'A'.repeat(32), 'ff'.repeat(20)]) {
      let r;
      expect(
        () => { r = tarolo.resolvePrivateDiskFile(nev, exp, sig); },
        'a szemét aláírás KIVÉTELT dobott — ez élesben 500 „Szerverhiba", '
        + 'hitelesítés nélkül, és minden szkennelés Sentry-riasztást szül',
      ).not.toThrow();
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('bad_signature');
    }
  });

  it('érvényes aláírás + hiányzó fájl → „not_found"', async () => {
    const tarolo = t();
    const { nev, exp, sig } = await ervenyesLink(tarolo);
    fs.unlinkSync(path.join(PRIVATE_DIR, nev));
    expect(tarolo.resolvePrivateDiskFile(nev, exp, sig).reason).toBe('not_found');
  });
});

// =====================================================================
//  6) TÖRLÉS — a GDPR 17. cikk és a retenciós kör igazsága ezen áll
// =====================================================================
describe('deleteFile', () => {
  it('privát fájl: a PRIVÁT bucketből törlünk', async () => {
    const t = betoltTarolo();
    expect(await t.deleteFile('private:kyc/abc.jpg')).toBe(true);
    const del = naplo.parancsok.find((p) => p.tipus === 'delete');
    expect(
      del.Bucket,
      'a KYC-okmányt a publikus bucketből próbáltuk törölni — a privátban '
      + 'ottmaradna, és a „30 nap után töröljük" ígéret hamis lenne',
    ).toBe('teszt-privat-bucket');
    expect(del.Key).toBe('kyc/abc.jpg');
  });

  it('publikus fájl: a publikus bucketből, a kulcsra képezve', async () => {
    const t = betoltTarolo();
    expect(await t.deleteFile('https://pub-teszt.r2.dev/deadbeef.jpg')).toBe(true);
    const del = naplo.parancsok.find((p) => p.tipus === 'delete');
    expect(del.Bucket).toBe('teszt-publikus-bucket');
    expect(del.Key, 'a publikus URL-ből rosszul fejtettük vissza a kulcsot').toBe('deadbeef.jpg');
  });

  it('R2-hiba esetén FALSE — a hívó így megtartja a DB-mutatót és riaszthat', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'R2 törlés elszállt';
    expect(
      await t.deleteFile('private:kyc/abc.jpg'),
      'SIKERESNEK JELENTETTÜK A SIKERTELEN TÖRLÉST. A retenciós kör erre '
      + 'letörli a DB-sort, az okmány pedig ÖRÖKRE a bucketben marad — árva '
      + 'fájl, amit már semmi nem talál meg.',
    ).toBe(false);
    expect(await t.deleteFile('https://pub-teszt.r2.dev/x.jpg')).toBe(false);
  });

  it('ISMERETLEN távoli URL → FALSE + Sentry-riasztás (2026-08-12, fail-closed)', async () => {
    const t = betoltTarolo();
    const sentry = require('@sentry/node');
    const uzenetek = [];
    vi.spyOn(sentry, 'captureMessage').mockImplementation((m) => { uzenetek.push(String(m)); });

    // Ez a valós forgatókönyv: az R2_PUBLIC_URL saját domainre vált, a régi
    // sorok viszont a RÉGI prefixszel vannak a DB-ben.
    const eredmeny = await t.deleteFile('https://regi-pub-xxx.r2.dev/deadbeef.jpg');
    expect(
      eredmeny,
      'AZ ISMERETLEN TÁVOLI URL-RE „SIKERES TÖRLÉST" JELENTETTÜNK.\n\n'
      + 'Ez a CSENDES, TÖMEGES árva-fájl gyár: az R2_PUBLIC_URL egyetlen '
      + 'megváltozása után a napi retenciós kör MINDEN régi fotóról letörli az '
      + 'egyetlen mutatót (feladói lakásbelső, kézbesítési bizonyíték), az '
      + 'objektumok pedig a PUBLIKUS bucketben maradnak. Riasztás nincs, '
      + '„beragadt = 0".',
    ).toBe(false);
    expect(
      uzenetek.length,
      'a fel nem ismert URL-ről nem ment Sentry-riasztás — a hiba csak akkor '
      + 'derülne ki, ha valaki kézzel egyeztetné a bucketet a DB-vel',
    ).toBeGreaterThan(0);
  });

  it('data: URL és relatív út → TRUE (nincs mit törölni), riasztás nélkül', async () => {
    const t = betoltTarolo();
    const sentry = require('@sentry/node');
    const uzenetek = [];
    vi.spyOn(sentry, 'captureMessage').mockImplementation((m) => { uzenetek.push(String(m)); });

    for (const u of ['data:image/png;base64,AAAA', '/static/alap-avatar.png', 'avatar.png']) {
      expect(
        await t.deleteFile(u),
        `a(z) "${u}" alakot törlendő objektumnak vettük — a retenciós kör `
        + 'végtelenül újrapróbálná, és a sor sosem záródna le',
      ).toBe(true);
    }
    expect(
      uzenetek,
      'ártalmatlan (nem-objektum) URL-ekre is riasztottunk — a riasztás '
      + 'elveszti az értékét, ha zajt ad',
    ).toEqual([]);
  });

  it('üres bemenet és üres kulcs → FALSE, külső hívás nélkül', async () => {
    const t = betoltTarolo();
    for (const u of [null, undefined, '', 'private:']) {
      expect(await t.deleteFile(u), `a(z) ${JSON.stringify(u)} bemenetre nem false jött`).toBe(false);
    }
    expect(naplo.parancsok, 'üres bemenetre is indítottunk R2-hívást').toEqual([]);
  });

  it('disk-módban a /uploads/ fájlt tényleg letörli, és nem lép ki a mappából', async () => {
    const t = betoltTarolo({ r2: false });
    const url = await t.saveFile(BAJTOK, 'x.jpg', 'image/jpeg');
    const fp = path.join(UPLOADS_DIR, path.basename(url));
    letrehozottFajlok.push(fp);
    expect(await t.deleteFile(url)).toBe(true);
    expect(fs.existsSync(fp), 'a disk-törlés nem törölt').toBe(false);

    // Traversal-kísérlet: a basename levágja az utat, a projekt-fájl megmarad.
    const veszelyes = path.join(UPLOADS_DIR, '..', 'package.json');
    await t.deleteFile('/uploads/../package.json');
    expect(
      fs.existsSync(veszelyes),
      'A TÖRLÉS KILÉPETT AZ UPLOADS MAPPÁBÓL — tetszőleges projekt-fájl '
      + 'törölhető lenne egy megfelelően összeállított URL-lel',
    ).toBe(true);
  });

  it('már nem létező disk-fájl törlése is sikeres (idempotens)', async () => {
    const t = betoltTarolo({ r2: false });
    expect(
      await t.deleteFile('/uploads/00000000000000000000000000000000.jpg'),
      'a nem létező fájl törlése hibát jelzett — a retenciós kör így minden '
      + 'körben újrapróbálná ugyanazt a sort',
    ).toBe(true);
  });
});
