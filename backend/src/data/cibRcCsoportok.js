// A CIB banki válaszkódok (RC) csoportjai a vásárlói tájékoztatáshoz
// (Fejlesztési javaslatok 7. o.: a kódok a MSGT32-re adott MSGT31-ből jönnek).
// A sikertelen fizetés után a feladó a CSOPORT szerinti magyarázatot kapja —
// a banki átvételi teszt ezt is ellenőrzi.
//
// 2026-09-29 (CIB PR-2/A): backend-forrás (e-mail, eredmény-API); a webes
// tükör a `web/src/lib/cibRcCsoport.ts` (PR-3), szinkronőrrel.
//
// ⚠️ Két ismert kétértelműség a banki dokumentációban (a CIB-bel tisztázandó):
//  * az X3 a kártya ÉS a technikai csoportban is szerepel — a kártya-csoportba
//    soroljuk, mert az ad a vásárlónak cselekvési lehetőséget;
//  * a 02 a MSGT11-ben „foglalt TrID"-t jelent, a MSGT31-ben technikai hibát —
//    ez a táblázat CSAK a MSGT31 (zárás/lekérdezés) kódjaira való.
const CSOPORT_KODOK = Object.freeze({
  kartya: Object.freeze(['03', '09', '12', '13', '20', '21', '22', '30', '34', '36', '42', '52', '54',
    '55', '56', '87', '88', '90', 'X3']),
  szamla: Object.freeze(['14', '15', '16', '17', '23', '24', '29', '32', '35', '45', '69', '70', '72',
    '74', '75', '76', '77', '78']),
  kapcsolat: Object.freeze(['08', '10', '19', '27', '31', '50', '60', '64', '65', '71', '86', '93',
    'A2', 'A9']),
  technikai: Object.freeze(['01', '02', '04', '05', '06', '07', '11', '18', '25', '26', '28', '33', '38',
    '39', '40', '41', '43', '44', '46', '49', '51', '53', '57', '61', '62', '63', '66', '67', '79',
    '80', '81', '85', '92', '94', '96', '98', 'R0', 'C2', 'X0', 'X1', 'X2', 'NT']),
});

// A vásárlói magyarázat csoportonként (a bank ajánlott szövegei alapján).
const RC_CSOPORT_UZENET = Object.freeze({
  kartya: 'Ellenőrizd a kártyaszámot, a lejárati dátumot és a kártya hátoldalán lévő '
    + 'biztonsági kódot (CVC/CVV), valamint azt, hogy a kártyád alkalmas-e internetes vásárlásra.',
  szamla: 'Ellenőrizd, van-e elegendő fedezet a számládon, és nem lépted-e túl a kártyád '
    + 'vásárlási limitjét.',
  kapcsolat: 'Valószínűleg megszakadt a kapcsolat, vagy lejárt a rendelkezésre álló idő. '
    + 'Kérjük, próbáld újra.',
  technikai: 'Ha a bank fizetőoldalán a Vissza, az Újratöltés vagy a Frissítés gombot használtad, '
    + 'a rendszer biztonsági okból automatikusan elutasította a tranzakciót. Kérjük, indíts új fizetést.',
});

// Az X0 a technikai csoportban van, de a vásárlónak a „ne frissíts" szöveg
// félrevezető lenne: a 3D Secure azonosítás bukott el a kibocsátónál.
const X0_UZENET = 'A kártyabirtokos-azonosítás (3D Secure) nem sikerült a kártyádat kibocsátó banknál. '
  + 'Kérjük, próbáld újra, vagy használj másik kártyát.';

const KOD_CSOPORT = new Map();
for (const [csoport, kodok] of Object.entries(CSOPORT_KODOK)) {
  for (const kod of kodok) if (!KOD_CSOPORT.has(kod)) KOD_CSOPORT.set(kod, csoport);
}

/**
 * Egy banki RC csoportja. `null` a sikerre (00), a folyamatban lévőre (PR)
 * és a hiányzó kódra. A TO (időtúllépés) a kapcsolati csoport („lejárt az
 * idő, próbáld újra"). Ismeretlen, nem sikeres kódra a technikai csoport jár
 * — a bank előírása szerint tetszőleges kódra kell egy általános hibaág.
 * @param {string|null|undefined} rc
 * @returns {'kartya'|'szamla'|'kapcsolat'|'technikai'|null}
 */
function rcCsoport(rc) {
  const kod = typeof rc === 'string' ? rc.trim().toUpperCase() : '';
  if (!kod || kod === '00' || kod === 'PR') return null;
  if (kod === 'TO') return 'kapcsolat';
  return KOD_CSOPORT.get(kod) || 'technikai';
}

module.exports = {
  CSOPORT_KODOK, RC_CSOPORT_UZENET, X0_UZENET, rcCsoport,
};
