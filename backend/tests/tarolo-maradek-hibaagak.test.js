// =====================================================================
//  TÁROLÓ — A MARADÉK HIBAÁGAK (2026-08-12, lefedettségi kör)
//
//  A `tarolo-hibaagak.test.js` az R2-mód fő útjait lefedi. Ami utána maradt,
//  az mind ugyanabba a családba tartozik: NÉMA BIZONYÍTÉK-VESZTÉS.
//
//   1. ÉLES R2-kiesésnél a publikus feltöltés a lemezre esik vissza. A
//      Railway-lemez NEM perzisztens: a következő deploynál a felvételi /
//      kézbesítési bizonyítékfotó eltűnik, a DB-ben halott `/uploads/…` URL
//      marad — amire a `deleteFile` `true`-t ad, tehát a retenció
//      „letöröltnek" könyveli. Ezért került bele 2026-08-12-én a
//      Sentry-riasztás; azt eddig SEMMI nem őrizte.
//   2. Ugyanez a riasztás NEM mehet ki dev/teszt futásban (különben zaj lesz,
//      és a zajos riasztást előbb-utóbb kikapcsolják).
//   3. R2-módban is előfordul RÉGI, relatív `/uploads/…` URL a DB-ben (a
//      disk-korszakból vagy épp az 1. pont fallbackjéből). A törlésnek ilyenkor
//      a lemezhez kell nyúlnia, nem az R2-höz.
//   4. Az aláírt privát link TÉNYLEGESEN a szerver titkához kötött.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

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
const EREDETI_ENV = Object.fromEntries(
  [...R2_KULCSOK, 'NODE_ENV', 'JWT_SECRET'].map((k) => [k, process.env[k]]),
);

let naplo;

/** Hamis AWS SDK a CJS-cache-ben — valódi bucketet SOHA nem érünk el. */
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
  m.filename = S3_UT; m.loaded = true;
  m.exports = {
    S3Client,
    PutObjectCommand: parancs('put'),
    DeleteObjectCommand: parancs('delete'),
    GetObjectCommand: parancs('get'),
  };
  require.cache[S3_UT] = m;

  const p = new Module(PRESIGN_UT, null);
  p.filename = PRESIGN_UT; p.loaded = true;
  p.exports = {
    getSignedUrl: async (_kliens, cmd, opts) => {
      naplo.presignKeresek.push({ ...cmd.input, expiresIn: opts?.expiresIn });
      return `https://hamis-presign.example/${cmd.input.Bucket}/${cmd.input.Key}`;
    },
  };
  require.cache[PRESIGN_UT] = p;
}

function betoltTarolo({ r2 = true, privatBucket = true, publikusUrl = 'https://pub-teszt.r2.dev' } = {}) {
  naplo = {
    klienskonfig: null, parancsok: [], presignKeresek: [], kuldesHiba: null,
  };
  hamisS3Modul();
  if (r2) {
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

/** A Sentry-üzenetek elkapása (a modult a storage hívásidőben require-eli). */
function riasztasFigyelo() {
  const Sentry = require('@sentry/node');
  const uzenetek = [];
  vi.spyOn(Sentry, 'captureMessage').mockImplementation((m, szint) => {
    uzenetek.push({ uzenet: String(m), szint });
  });
  return uzenetek;
}

// =====================================================================
//  1) ÉLES R2-KIESÉS A PUBLIKUS ÁGON — a néma bizonyíték-vesztés
// =====================================================================
describe('saveFile: R2-kiesés élesben', () => {
  it('a fallback MEGTÖRTÉNIK (a fuvar nem akad el), de RIASZTÁST is küld', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'R2 503 Service Unavailable';
    const uzenetek = riasztasFigyelo();

    process.env.NODE_ENV = 'production';
    let url;
    try {
      url = await t.saveFile(BAJTOK, 'kezbesites.jpg', 'image/jpeg');
    } finally {
      process.env.NODE_ENV = 'test';
    }

    expect(
      url,
      'Az R2-kiesés után nem kaptunk URL-t. A fotó-feltöltés végpontja '
      + '500-zal szállna el, és a szállító nem tudná lezárni a fuvart — '
      + 'a fallback maga tehát HELYES.',
    ).toMatch(/^\/uploads\/[0-9a-f]{32}\.jpg$/);
    letrehozottFajlok.push(path.join(UPLOADS_DIR, path.basename(url)));

    expect(
      uzenetek.length,
      'ÉLES R2-KIESÉSNÉL NÉMÁN A LEMEZRE ESTÜNK. A Railway-lemez nem '
      + 'perzisztens: a következő deploynál a felvételi/kézbesítési '
      + 'BIZONYÍTÉKFOTÓ eltűnik, a DB-ben halott `/uploads/…` URL marad — '
      + 'amire a deleteFile `true`-t ad, tehát a retenció „letöröltnek" '
      + 'könyveli. Riasztás nélkül ez csak hónapokkal később, egy vitánál '
      + 'derülne ki, amikor már nincs bizonyíték.',
    ).toBeGreaterThan(0);
    expect(
      uzenetek[0].szint,
      'a riasztás nem hiba-szintű — a Sentryben elveszne a figyelmeztetések közt',
    ).toBe('error');
    expect(
      uzenetek[0].uzenet,
      'a riasztás szövegéből nem derül ki, MI a tét (a fotó elvész a deploynál)',
    ).toMatch(/perzisztens|elvész/i);
  });

  it('dev/teszt futásban ugyanez NEM riaszt (a riasztás ne legyen zajos)', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'R2 503';
    const uzenetek = riasztasFigyelo();

    const url = await t.saveFile(BAJTOK, 'kep.jpg', 'image/jpeg');
    letrehozottFajlok.push(path.join(UPLOADS_DIR, path.basename(url)));

    expect(
      uzenetek,
      'Fejlesztői/teszt futásban is riasztottunk. Egy zajos riasztást '
      + 'előbb-utóbb kikapcsolnak vagy elnémítanak — és pont akkor nem szól '
      + 'majd, amikor élesben tényleg baj van.',
    ).toEqual([]);
  });

  it('a Sentry hiánya sem akaszthatja meg a feltöltést', async () => {
    const t = betoltTarolo();
    naplo.kuldesHiba = 'R2 503';
    const Sentry = require('@sentry/node');
    vi.spyOn(Sentry, 'captureMessage').mockImplementation(() => {
      throw new Error('a Sentry-kliens nincs inicializálva');
    });

    process.env.NODE_ENV = 'production';
    let url;
    try {
      await expect(
        (async () => { url = await t.saveFile(BAJTOK, 'kep.jpg', 'image/jpeg'); })(),
        'A RIASZTÁS HIBÁJA MEGBUKTATTA A FELTÖLTÉST. A megfigyelés sosem '
        + 'lehet kritikus út: egy Sentry-kvóta vagy hálózati hiba így az '
        + 'egész fotó-feltöltést kiütné.',
      ).resolves.not.toThrow();
    } finally {
      process.env.NODE_ENV = 'test';
    }
    letrehozottFajlok.push(path.join(UPLOADS_DIR, path.basename(url)));
    expect(url).toMatch(/^\/uploads\//);
  });
});

// =====================================================================
//  2) TÖRLÉS R2-MÓDBAN, DE RÉGI (relatív) URL-LEL
// =====================================================================
describe('deleteFile R2-módban', () => {
  it('a régi, relatív /uploads/ URL-t a LEMEZRŐL törli, nem az R2-ből', async () => {
    // Ilyen sor valósan keletkezik: a disk-korszakból, vagy épp az élesben
    // fallbackelt feltöltésből (lásd fent).
    const disk = betoltTarolo({ r2: false });
    const url = await disk.saveFile(BAJTOK, 'regi.jpg', 'image/jpeg');
    const fp = path.join(UPLOADS_DIR, path.basename(url));
    letrehozottFajlok.push(fp);
    expect(fs.existsSync(fp)).toBe(true);

    const t = betoltTarolo({ r2: true });
    expect(await t.deleteFile(url)).toBe(true);
    expect(
      fs.existsSync(fp),
      'R2-MÓDBAN A RÉGI LEMEZES FÁJLT NEM TÖRÖLTÜK. A GDPR 17. cikk szerinti '
      + 'törlés így a disk-korszakból származó (vagy fallbackkel keletkezett) '
      + 'fájlokat kihagyná — pont azokat, amikről a legkevésbé tudunk.',
    ).toBe(false);
    expect(
      naplo.parancsok,
      'egy relatív /uploads/ útra R2-hívást indítottunk — az bucketen kívüli '
      + 'kulcsot próbálna törölni, és feleslegesen hibázna',
    ).toEqual([]);
  });

  it('a publikus prefix ÖNMAGÁBAN (kulcs nélkül) nem indít törlést', async () => {
    const t = betoltTarolo();
    expect(
      await t.deleteFile('https://pub-teszt.r2.dev/'),
      'Kulcs nélküli URL-re sikert jelentettünk — a hívó azt hinné, hogy '
      + 'törölt valamit, holott nem volt mit.',
    ).toBe(false);
    expect(
      naplo.parancsok,
      'ÜRES KULCCSAL indítottunk R2 DeleteObject hívást. Az S3-kompatibilis '
      + 'API-n az üres/kóros kulcs viselkedése nem definiált — ilyet nem '
      + 'küldünk ki.',
    ).toEqual([]);
  });
});

// =====================================================================
//  3) PRIVÁT OLVASÁS PRIVÁT BUCKET NÉLKÜL (a dokumentált visszaesés)
// =====================================================================
describe('getSignedPrivateUrl privát bucket nélkül', () => {
  it('a PUBLIKUS bucketre ír alá — de továbbra is ALÁÍRT, lejáró linkkel', async () => {
    const t = betoltTarolo({ privatBucket: false });
    const url = await t.getSignedPrivateUrl('private:kyc/abc.jpg', 60);

    expect(
      naplo.presignKeresek[0].Bucket,
      'A privát bucket hiányában a MENTÉS a publikusba esik vissza (kyc/ '
      + 'prefixszel), az OLVASÁS viszont máshova mutatna — az admin '
      + 'KYC-felülete így üres képet mutatna, és a hiba csak akkor derülne ki, '
      + 'amikor egy okmányt kellene ellenőrizni.',
    ).toBe('teszt-publikus-bucket');
    expect(naplo.presignKeresek[0].Key).toBe('kyc/abc.jpg');
    expect(
      url,
      'a visszaesésnél nyers (aláíratlan) publikus URL-t adtunk vissza — az '
      + 'okmány bárki számára lehívhatóvá válna',
    ).toContain('hamis-presign');
  });

  it('R2-módban perzisztensnek vallja magát (a hívó erre alapoz)', () => {
    expect(betoltTarolo().isPersistent()).toBe(true);
    expect(betoltTarolo({ r2: false }).isPersistent()).toBe(false);
  });
});

// =====================================================================
//  4) AZ ALÁÍRT PRIVÁT LINK TÉNYLEG A SZERVER TITKÁHOZ KÖTŐDIK
// =====================================================================
describe('signPrivateDiskUrl: a titok számít', () => {
  it('más JWT_SECRET → más aláírás, és a régi link NEM nyílik meg', async () => {
    const t = betoltTarolo({ r2: false });
    const jelolo = await t.savePrivateFile(BAJTOK, 'szemelyi.jpg', 'image/jpeg');
    const nev = path.basename(jelolo.slice('private:'.length));
    letrehozottFajlok.push(path.join(UPLOADS_DIR, 'private', nev));

    const eredetiTitok = process.env.JWT_SECRET;
    let regi;
    let uj;
    try {
      process.env.JWT_SECRET = 'titok-A';
      regi = new URLSearchParams((await t.getSignedPrivateUrl(jelolo, 600)).split('?')[1]);
      process.env.JWT_SECRET = 'titok-B';
      uj = new URLSearchParams((await t.getSignedPrivateUrl(jelolo, 600)).split('?')[1]);

      expect(
        uj.get('sig'),
        'A TITOK MEGVÁLTOZOTT, AZ ALÁÍRÁS NEM. Akkor az aláírás nem a '
        + 'szerver titkából származik — bárki, aki ismeri a képletet (a kód '
        + 'nyílt), tetszőleges KYC-okmányhoz gyárthatna érvényes linket.',
      ).not.toBe(regi.get('sig'));

      expect(
        t.resolvePrivateDiskFile(nev, regi.get('exp'), regi.get('sig')).ok,
        'A TITOK-CSERE UTÁN IS MŰKÖDÖTT A RÉGI LINK. Egy kulcs-rotáció így '
        + 'nem érvénytelenítené a korábban kiadott okmány-linkeket.',
      ).toBe(false);
      expect(t.resolvePrivateDiskFile(nev, uj.get('exp'), uj.get('sig')).ok).toBe(true);
    } finally {
      process.env.JWT_SECRET = eredetiTitok;
    }
  });

  it('titok NÉLKÜL is aláír (dev-alapérték), de a link akkor is lejár', async () => {
    const t = betoltTarolo({ r2: false });
    const jelolo = await t.savePrivateFile(BAJTOK, 'szemelyi.jpg', 'image/jpeg');
    const nev = path.basename(jelolo.slice('private:'.length));
    letrehozottFajlok.push(path.join(UPLOADS_DIR, 'private', nev));

    const eredetiTitok = process.env.JWT_SECRET;
    try {
      // ⚠️ Fejlesztői gépen a JWT_SECRET hiányozhat. A link ilyenkor egy
      // KÖZISMERT alapértékkel íródik alá — ez SZÁNDÉKOS dev-kényelem, de a
      // lejáratnak akkor is működnie kell, különben egy ilyen link örökre él.
      delete process.env.JWT_SECRET;
      const q = new URLSearchParams((await t.getSignedPrivateUrl(jelolo, -10)).split('?')[1]);
      const r = t.resolvePrivateDiskFile(nev, q.get('exp'), q.get('sig'));
      expect(
        r.ok,
        'Titok nélküli (dev) módban a LEJÁRT link is megnyílt — a lejárat '
        + 'ellenőrzése az aláírás-ágtól függetlenül kötelező.',
      ).toBe(false);
      expect(r.reason).toBe('expired');
    } finally {
      process.env.JWT_SECRET = eredetiTitok;
    }
  });
});
