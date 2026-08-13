// =====================================================================
//  BANKI FELKÉSZÜLÉSI ANYAG — a letölthető fájl és a titok-tartás őre
//
//  Két dolgot véd:
//
//  (1) A LETÖLTÖTT FÁJL HASZNÁLHATÓ LEGYEN. A tárgyaláson ez a fájl lesz a
//      kezedben, esetleg offline — ha hiányos vagy törött, ott derül ki.
//
//  (2) ⚠️ A TARTALOM NE KERÜLJÖN A FRONTEND FORRÁSÁBA. Az első változatban a
//      szöveg ebben a modulban élt, és a kliens-oldali admin-kapu csak a
//      MEGJELENÍTÉST állította meg: a szöveg bekerült a publikus JS-chunkba,
//      és bárki letölthette bejelentkezés nélkül (lemérve a
//      `.next/static/chunks/`-ban). A tartalom mostantól admin-kapus
//      végpontról jön — ez az őr azt zárja le, hogy valaki „kényelemből"
//      visszamásolja a szöveget a frontendbe.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bankDokumentumHtml, type BankDokumentum } from './bankFelkeszules';

const ADAT_UT = path.resolve(__dirname, '..', '..', '..', 'shared', 'bank-felkeszules.json');
const dok: BankDokumentum = JSON.parse(fs.readFileSync(ADAT_UT, 'utf8'));

describe('a letölthető dokumentum', () => {
  const html = bankDokumentumHtml(dok, '2026. augusztus 13.');

  it('önálló fájl: nincs benne EGYETLEN külső hivatkozás sem', () => {
    // A tárgyaláson lehet gyenge a térerő, vagy egyáltalán nincs net. Egy
    // külső betűtípus vagy szkript ilyenkor csak lassít vagy elrontja a lapot.
    const kulso = html.match(/(src|href)\s*=\s*["']https?:\/\/[^"']+/gi) || [];
    expect(
      kulso,
      'A letölthető fájl külső erőforrásra hivatkozik. Offline (vagy rossz '
      + 'térerőn) ez üres helyet vagy hibás megjelenést okoz — pont a bank előtt.',
    ).toEqual([]);
  });

  it('MINDEN szakasz benne van (nem csonkul a fájl)', () => {
    for (const sz of dok.szakaszok) {
      expect(html, `Hiányzik a "${sz.cim}" szakasz a letöltött fájlból.`)
        .toContain(sz.cim);
    }
    expect(dok.szakaszok.length).toBeGreaterThanOrEqual(8);
  });

  it('a legfontosabb üzenet és a döntést igénylő pont is benne van', () => {
    // Ez a két dolog az, amiért a dokumentum egyáltalán készült.
    expect(html).toContain('kapcsolatfelvételi díjat');
    expect(html.toLowerCase()).toContain('marketplace');
    expect(
      html,
      'A kitöltendő (piros) blokk hiányzik — pedig épp az a forgalmi cél, '
      + 'amit a tárgyalás előtt el kell dönteni.',
    ).toContain('kitoltendo');
  });

  it('nyomtatható: van benne @media print szabály', () => {
    expect(
      html,
      'Nincs nyomtatási stílus. A böngésző „Nyomtatás → PDF" útja így csúnya '
      + 'vagy rosszul tördelt lapot adna — ez a fájl EGYETLEN PDF-útja.',
    ).toContain('@media print');
  });

  it('a HTML-t nem lehet a tartalomból kitörni (escape)', () => {
    const gonosz: BankDokumentum = {
      cim: '<script>alert(1)</script>',
      alcim: 'a & b',
      szakaszok: [{
        cim: '<img src=x onerror=alert(1)>',
        blokkok: [
          { fajta: 'bekezdes', szoveg: '</p><script>rossz()</script>' },
          { fajta: 'lista', elemek: ['<b>nem félkövér</b>'] },
          {
            fajta: 'tabla',
            fejlec: ['<th>x</th>', 'y'],
            sorok: [['</td></tr><script>a()</script>', 'z']],
          },
        ],
      }],
    };
    const veszelyes = bankDokumentumHtml(gonosz, 'ma');
    // A stílusblokkot nem nézzük — abban legitim módon szerepelhet '<'.
    const torzs = veszelyes.slice(veszelyes.indexOf('<body>'));
    expect(
      torzs.includes('<script>alert(1)</script>')
      || torzs.includes('<script>rossz()</script>')
      || torzs.includes('<img src=x'),
      'A dokumentum tartalmából ki lehet törni a HTML-be. Ma az adat megbízható '
      + 'forrásból jön, de a generátor akkor is escape-eljen — különben egy '
      + 'későbbi, szerkeszthető változat azonnal sebezhetővé tenné.',
    ).toBe(false);
  });
});

describe('titok-tartás: a tartalom nem lehet a frontend forrásában', () => {
  const modulForras = fs.readFileSync(path.join(__dirname, 'bankFelkeszules.ts'), 'utf8');

  it('a modul CSAK típust és megjelenítést tartalmaz, adatot nem', () => {
    // Néhány jellegzetes, a dokumentumra egyedi kifejezés. Ha ezek bármelyike
    // megjelenik a frontend forrásában, a szöveg visszakerült a bundle-be.
    const arulkodo = [
      'payment facilitator',
      'rolling reserve',
      'Tiszta Hód Korlátolt',
      '06-09-020646',
      '24750792',
      'Cégkivonat',
    ];
    const talalt = arulkodo.filter((k) => modulForras.includes(k));
    expect(
      talalt,
      `A dokumentum tartalma visszakerült a frontend forrásába: ${talalt.join(', ')}.\n\n`
      + 'A kliens-oldali admin-kapu CSAK a megjelenítést állítja meg — a\n'
      + 'bundle-be sütött szöveget bárki letöltheti bejelentkezés nélkül, a\n'
      + '`/_next/static/chunks/` alól. Az első változatban ez tényleg így volt,\n'
      + 'és méréssel derült ki.\n\n'
      + 'A tartalom helye: `shared/bank-felkeszules.json`, és a\n'
      + '`GET /admin/dokumentumok/bank-felkeszules` végponton át jön.',
    ).toEqual([]);
  });

  it('a megosztott adatfájl létezik és ép', () => {
    expect(fs.existsSync(ADAT_UT), 'Hiányzik a shared/bank-felkeszules.json').toBe(true);
    expect(dok.cim).toBeTruthy();
    expect(Array.isArray(dok.szakaszok)).toBe(true);
    for (const sz of dok.szakaszok) {
      expect(sz.cim, 'szakasz cím nélkül').toBeTruthy();
      expect(sz.blokkok.length, `üres szakasz: ${sz.cim}`).toBeGreaterThan(0);
    }
  });
});
