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

const R = require('../src/services/retention');

const TAJEKOZTATO = readFileSync(`${__dirname}/../../web/app/adatkezeles/page.tsx`, 'utf8');

/**
 * konstans → [elvárt érték, mit ígérünk, a tájékoztatóban keresendő szöveg]
 *
 * A `szoveg` szándékosan RÖVID és a SZÁMOT tartalmazza — a mondat többi
 * részének átfogalmazása ne törje el a tesztet, a szám megváltozása igen.
 */
const HORGONYOK = {
  JOB_PII_RETENTION_YEARS: [3, 'a lezárt fuvar személyes adatai', '3 év'],
  HOLD_RETENTION_YEARS: [5, 'vitás/zárolt ügylet bizonyítéka', '5 év'],
  DEFAULT_RETENTION_DAYS: [30, 'fuvar-fotók a lezárás után', '30 nap'],
  CHAT_RETENTION_MONTHS: [6, 'chat-üzenetek a lezárás után', '6 hónap'],
  GPS_RETENTION_DAYS: [7, 'nyers GPS-pingek', '7 nap'],
  INVOICE_RETENTION_YEARS: [8, 'számlák (Számv. tv. 169. §)', '8 év'],
  DELETED_ACCOUNT_RETENTION_YEARS: [5, 'törölt fiók lenyomata', '5 év'],
  TAX_DATA_RETENTION_YEARS: [5, 'DAC7 adóazonosító', '5 év'],
  ADMIN_DM_RETENTION_YEARS: [3, 'admin-levelezés (Fgytv. 17/A. §)', '3 év'],
  NOTIFICATION_RETENTION_MONTHS: [6, 'értesítések', '6 hónap'],
  SOS_LOCATION_RETENTION_DAYS: [7, 'vészjelzés helyadata', '7 nap'],
  SOS_EVENT_RETENTION_YEARS: [1, 'vészjelzés ténye', '1 év'],
  ADMIN_ACCESS_LOG_RETENTION_YEARS: [1, 'admin-hozzáférési napló', '1 év'],
  ABANDONED_JOB_YEARS: [1, 'félbehagyott fuvar lejáratása', '1 év'],
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

  it('az ígéret tényleg ott van a tájékoztatóban', () => {
    // A szöveg-oldal: ha valaki a publikált számot írja át, arról is
    // tudatos döntés szülessen. Az ékezetes/nem törhető szóközt egységesítjük.
    const norm = TAJEKOZTATO.replace(/ /g, ' ').replace(/\s+/g, ' ');
    const hianyzo = [...new Set(Object.values(HORGONYOK).map(([, , sz]) => sz))]
      .filter((sz) => !norm.includes(sz));
    expect(
      hianyzo,
      `Ezek a megőrzési idők nem szerepelnek az adatkezelési tájékoztatóban: ${hianyzo.join(', ')}\n\n`
      + 'Vagy a tájékoztatóból tűnt el az ígéret (GDPR 13. cikk (2) a — a megőrzési\n'
      + 'időt közölni KELL), vagy a horgony-tábla avult el.',
    ).toEqual([]);
  });

  it('a zárolt ügylet HOSSZABB ideig őrződik, mint a sima', () => {
    // Invariáns, nem literál: a bizonyíték-zárolásnak felül kell írnia a
    // normál elévülést, különben a vitás ügy bizonyítéka hamarabb tűnne el.
    expect(R.HOLD_RETENTION_YEARS).toBeGreaterThan(R.JOB_PII_RETENTION_YEARS);
    expect(R.HOLD_RETENTION_YEARS * 365).toBeGreaterThan(R.DEFAULT_RETENTION_DAYS);
  });
});
