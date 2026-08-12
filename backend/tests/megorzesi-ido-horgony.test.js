// =====================================================================
//  MEGŐRZÉSI IDŐ — HORGONY-ŐR (2026-08-11)
//
//  ⚠️ MIÉRT: a retenciós őr eddig azt mérte, hogy a törlés MEGTÖRTÉNIK-E —
//  azt nem, hogy MIKOR. A hosszt minden teszt önmagához képest használta
//  (`JOB_PII_RETENTION_YEARS + 1` év múlva töröljön), ezért a konstanst
//  3-ról 30-ra átírva AZ EGÉSZ SUITE ZÖLD MARADT volna: a 31 éves fuvart
//  továbbra is anonimizálja, az 1 évest továbbra sem bántja. Közben a
//  felhasználónak 3 évet ígérünk.
//
//  Ez a fájl a számokat a PUBLIKÁLT ígérethez köti. Két irányban véd:
//    1. a konstans nem csúszhat el némán (literál-egyezés),
//    2. az ígéret nem tűnhet el a tájékoztatóból (szöveg-egyezés) — ha
//       valaki átírja a szöveget, itt kell tudatosan dönteni.
//
//  Ha egy megőrzési időt MEG AKARSZ változtatni, az nem bug, hanem döntés:
//  írd át a konstansot, a tájékoztatót ÉS ezt a táblát, egy commitban.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const R = {
  ...require('../src/services/retention'),
  TRACKING_GRACE_DAYS: require('../src/routes/publicTracking').TRACKING_GRACE_DAYS,
  // ⚠️ A KYC-fájl retenciója MÁSIK modulban él (services/kyc.js) — épp ezért
  // maradt ki eddig a horgonyból. A konstansokat egy térképbe olvasztjuk,
  // hogy a horgony ne a fájl-határnál álljon meg.
  KYC_FILE_RETENTION_DAYS: require('../src/services/kyc').KYC_FILE_RETENTION_DAYS,
};

const TAJEKOZTATO = readFileSync(`${__dirname}/../../web/app/adatkezeles/page.tsx`, 'utf8');

/**
 * konstans → [elvárt érték, mit ígérünk, a tájékoztatóban keresendő szöveg]
 *
 * A `szoveg` szándékosan RÖVID és a SZÁMOT tartalmazza — a mondat többi
 * részének átfogalmazása ne törje el a tesztet, a szám megváltozása igen.
 */
// konstans → [elvárt érték, mit ígérünk, a SZÁM, a bekezdést azonosító KIFEJEZÉS]
//
// ⚠️ A NEGYEDIK ELEM 2026-08-11-ÉN KERÜLT BE, MERT A SZÁM ÖNMAGÁBAN NEM VÉD.
// A korábbi változat csak azt nézte, hogy a '8 év' részsztring előfordul-e
// valahol az 584 soros oldalon — és a „kizárólag 18 éven felüliek" mondat ezt
// KIELÉGÍTETTE. Vagyis a rendszer LEGHOSSZABB megőrzési idejének közlése
// (számlán a név + cím + adószám 8 évig, GDPR 13. cikk (2) a) törölhető lett
// volna a tájékoztatóból zöld build mellett. Ugyanígy a '3 év' 5×, az '5 év'
// 10× fordul elő — egyetlen ígéret sem volt egyedileg védve.
// Mostantól a számnak és a hozzá tartozó kifejezésnek EGY bekezdésben kell
// állnia, tehát a konkrét ígéret eltűnése pirosra vált.
const HORGONYOK = {
  JOB_PII_RETENTION_YEARS: [3, 'a lezárt fuvar személyes adatai', '3 év', 'fuvar'],
  HOLD_RETENTION_YEARS: [5, 'vitás/zárolt ügylet bizonyítéka', '5 év', 'vitatott'],
  DEFAULT_RETENTION_DAYS: [30, 'fuvar-fotók a lezárás után', '30 nap', 'fotó'],
  CHAT_RETENTION_MONTHS: [6, 'chat-üzenetek a lezárás után', '6 hónap', 'üzenet'],
  GPS_RETENTION_DAYS: [7, 'nyers GPS-pingek', '7 nap', 'GPS'],
  // ⚠️ 'kiállítás', nem 'számláz': a fizetési napló bekezdése is tartalmazza a
  // 'számláz' szót 8 év mellett, tehát a SZÁMLA-megőrzés közlése törölhető
  // maradt volna. A horgony akkor ér valamit, ha EGYEDI a bekezdésére.
  INVOICE_RETENTION_YEARS: [8, 'számlák (Számv. tv. 169. §)', '8 év', 'kiállítás'],
  DELETED_ACCOUNT_RETENTION_YEARS: [5, 'törölt fiók lenyomata', '5 év', 'törölt fiók'],
  TAX_DATA_RETENTION_YEARS: [5, 'DAC7 adóazonosító', '5 év', 'adóazonosító'],
  ADMIN_DM_RETENTION_YEARS: [3, 'admin-levelezés (Fgytv. 17/A. §)', '3 év', 'GoFuvar csapatával'],
  NOTIFICATION_RETENTION_MONTHS: [6, 'értesítések', '6 hónap', 'értesítés'],
  SOS_LOCATION_RETENTION_DAYS: [7, 'vészjelzés helyadata', '7 nap', 'vészjelzés'],
  SOS_EVENT_RETENTION_YEARS: [1, 'vészjelzés ténye', '1 év', 'vészjelzés'],
  ADMIN_ACCESS_LOG_RETENTION_YEARS: [1, 'admin-hozzáférési napló', '1 év', 'hozzáférési'],
  ABANDONED_JOB_YEARS: [1, 'félbehagyott fuvar lejáratása', '1 év', 'fuvar'],
  // ⚠️ A LEGÉRZÉKENYEBB ADAT, ÉS EDDIG NEM VOLT HORGONYOZVA (2026-08-11):
  // a nyers okmányfotó törlése. A 9. mérés ellenpéldája szerint a 30 → 3650
  // átírás az EGÉSZ suite-on átment volna — a személyi igazolvány fotója
  // 10 évig maradt volna a privát bucketben, miközben a tájékoztató
  // FÉLKÖVÉREN 30 napot ígér.
  KYC_FILE_RETENTION_DAYS: [30, 'a nyers okmányfotó a döntés után', '30 nap', 'okmány'],
  // ⚠️ EGY PUBLIKUS, HITELESÍTÉS NÉLKÜLI VÉGPONT ÉLETTARTAMA (10. mérés A6):
  // a követő-linken a címzett neve, a pontos kézbesítési cím, a szállító
  // neve+telefonja és az átvételi kód érhető el. Eddig semmi nem kötötte a
  // publikált ígérethez: bármely érték a [3, 29] tartományban némán átcsúszott.
  TRACKING_GRACE_DAYS: [14, 'a követő-link élettartama a kézbesítés után', '14 nap', 'követ'],
};

describe('Megőrzési idők — a szám a publikált ígérethez van kötve', () => {
  it('egyetlen megőrzési idő sem csúszhat el némán', () => {
    const elteres = [];
    for (const [nev, [vart, mit]] of Object.entries(HORGONYOK)) {
      const tenyleges = R[nev];
      if (tenyleges === undefined) {
        elteres.push(`${nev}: NINCS EXPORTÁLVA (a horgony vak lenne rá)`);
      } else if (tenyleges !== vart) {
        elteres.push(`${nev}: ${tenyleges} — de ${vart} az ígéret (${mit})`);
      }
    }
    expect(
      elteres,
      `Megőrzési idő csúszott el a publikált ígérethez képest:\n  ${elteres.join('\n  ')}\n\n`
      + 'A többi teszt ezt NEM veszi észre: azok a konstanshoz képest mérnek\n'
      + '(„a konstans + 1 év múlva töröljön"), tehát bármilyen értékkel zöldek.\n'
      + 'Ha a változtatás SZÁNDÉKOS: írd át a tájékoztatót és ezt a táblát is.',
    ).toEqual([]);
  });

  it('az ígéret tényleg ott van a tájékoztatóban — BEKEZDÉS-szinten', () => {
    // Bekezdésekre bontunk (a lista-elemek a <li> határok mentén), és
    // megköveteljük, hogy a SZÁM és a hozzá tartozó KIFEJEZÉS EGYÜTT álljon.
    // A puszta szám-keresés nem véd: a „18 éven felüliek" mondat kielégítette
    // a '8 év' horgonyt, tehát a 8 éves számla-megőrzés közlése törölhető volt.
    // ⚠️ ELŐBB BONTUNK, UTÁNA SZEDJÜK LE A CÍMKÉKET. Az első változat fordítva
    // csinálta, ezért a `</li>` határ már nem létezett, és egyetlen óriási
    // szövegdarab keletkezett — amiben persze minden szó „együtt áll" minden
    // számmal. A horgony így semmit nem védett (lemérve: a számla-bekezdés
    // törlése után is zöld maradt).
    const bekezdesek = TAJEKOZTATO
      .split(/<\/li>|<\/p>/i)
      .map((b2) => b2.replace(/ /g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));

    const hianyzo = [];
    for (const [nev, [, mit, szam, kifejezes]] of Object.entries(HORGONYOK)) {
      const talalt = bekezdesek.some(
        (b2) => b2.includes(szam) && b2.toLowerCase().includes(kifejezes.toLowerCase()),
      );
      if (!talalt) hianyzo.push(`${nev}: "${szam}" + "${kifejezes}" nem áll együtt (${mit})`);
    }
    expect(
      hianyzo,
      `Ezek a megőrzési ígéretek nem szerepelnek együtt a tájékoztatóban:\n  ${hianyzo.join('\n  ')}\n\n`
      + 'A GDPR 13. cikk (2) a) szerint a megőrzési időt közölni KELL. A szám\n'
      + 'önmagában nem bizonyíték: a 8 év horgonyt korábban a „18 éven felüliek"\n'
      + 'mondat elégítette ki. Vagy a közlés tűnt el, vagy a horgony avult el.',
    ).toEqual([]);
  });

  it('a zárolt ügylet HOSSZABB ideig őrződik, mint a sima', () => {
    // Invariáns, nem literál: a bizonyíték-zárolásnak felül kell írnia a
    // normál elévülést, különben a vitás ügy bizonyítéka hamarabb tűnne el.
    expect(R.HOLD_RETENTION_YEARS).toBeGreaterThan(R.JOB_PII_RETENTION_YEARS);
    expect(R.HOLD_RETENTION_YEARS * 365).toBeGreaterThan(R.DEFAULT_RETENTION_DAYS);
  });
});
