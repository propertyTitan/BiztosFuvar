// =====================================================================
//  CIB RC-CSOPORTOK — a sikertelen fizetés ügyfélnek szóló magyarázata
//
//  Forrás: CIB „Fejlesztési javaslatok" — Tranzakciós hibakódok. A MSGT32-re
//  adott MSGT31 kódjaiból a bank NÉGY csoportot képzett (kártya / számla /
//  kapcsolati / technikai), és mindegyikhez megfogalmazta a vásárlónak szóló
//  figyelmeztetést. A kódlistát BETŰRE átvettük; a figyelmeztetések tartalma
//  a bankéval azonos, a GoFuvar tegező hangnemére igazítva.
//
//  Két külön kód, saját magyarázattal (CIB GYFK):
//   - X0: a kibocsátó bank 3D Secure hitelesítése sikertelen (a technikai
//     csoportban is szerepel, de a vásárlónak mást kell tennie);
//   - TO: időtúllépés (a MSGT33-ra) — a bank reverzált, nem terheltünk.
//
//  ⚠️ Az X3 a banki listán KÉT csoportban is szerepel (kártya ÉS technikai).
//  A feloldás a lista sorrendje: az első találat (kártya) nyer.
//
//  A csoportot elsődlegesen a BACKEND adja (`rc_csoport`, ugyanebből a banki
//  listából — backend/src/data/cibRcCsoportok.js); a web tábla tartalék és a
//  szinkronőr párja. Őr: cibRcCsoport.test.ts.
// =====================================================================

export type RcCsoport = 'kartya' | 'szamla' | 'kapcsolat' | 'technikai';

export const RC_CSOPORT_SORREND: readonly RcCsoport[] = ['kartya', 'szamla', 'kapcsolat', 'technikai'];

export const RC_CSOPORT_KODOK: Record<RcCsoport, readonly string[]> = {
  kartya: ['03', '09', '12', '13', '20', '21', '22', '30', '34', '36', '42', '52', '54', '55', '56', '87', '88', '90', 'X3'],
  szamla: ['14', '15', '16', '17', '23', '24', '29', '32', '35', '45', '69', '70', '72', '74', '75', '76', '77', '78'],
  kapcsolat: ['08', '10', '19', '27', '31', '50', '60', '64', '65', '71', '86', '93', 'A2', 'A9'],
  technikai: [
    '01', '02', '04', '05', '06', '07', '11', '18', '25', '26', '28', '33', '38', '39', '40', '41', '43', '44', '46', '49', '51',
    '53', '57', '61', '62', '63', '66', '67', '79', '80', '81', '85', '92', '94', '96', '98', 'R0', 'C2', 'X0', 'X1', 'X2', 'X3',
    'NT',
  ],
};

export const RC_CSOPORT_NEV: Record<RcCsoport, string> = {
  kartya: 'Kártya jellegű hiba',
  szamla: 'Számla jellegű hiba',
  kapcsolat: 'Kapcsolati jellegű hiba',
  technikai: 'Technikai jellegű hiba',
};

/** A bank vásárlói tájékoztatójának záró mondata a részletekről. */
export const BANKI_TOVABBI_INFO =
  'Ha a tranzakció eredményéről, sikertelensége esetén annak okáról és részleteiről bővebben szeretnél tájékozódni, vedd fel a kapcsolatot a számlavezető bankoddal.';

export type UgyfelUzenet = {
  cim: string;
  pontok: string[];
  /** Új fizetéssel orvosolható-e (a bank szerint minden sikertelen kísérlet után kötelező felkínálni). */
  ujraProbalhato: boolean;
};

const UZENETEK: Record<RcCsoport, UgyfelUzenet> = {
  kartya: {
    cim: 'A bank a kártyaadatok vagy a kártya miatt utasította el a fizetést.',
    pontok: [
      'Ellenőrizd, hogy jól írtad-e be a kártyaszámot!',
      'Ellenőrizd, hogy jól írtad-e be a kártya lejárati dátumát!',
      'Ellenőrizd, hogy nem járt-e le a kártyád!',
      'Mastercard vagy Maestro kártyánál ellenőrizd, hogy beírtad-e a kártya hátoldalán, az aláíráscsíkon szereplő szám utolsó három számjegyét (CVC-kód)!',
      'Ellenőrizd, hogy a kártyád alkalmas-e internetes vásárlásra!',
      'Visa kártyánál ellenőrizd, hogy a hátoldalán szerepel-e a 3 számjegyű CVV-kód! Ha igen, írd be!',
    ],
    ujraProbalhato: true,
  },
  szamla: {
    cim: 'A bank a kártyához tartozó számla miatt utasította el a fizetést.',
    pontok: [
      'Ellenőrizd, hogy van-e elegendő pénz a számládon a fizetéshez!',
      'Ellenőrizd, hogy nem lépted-e túl a kártyád engedélyezett limitjét!',
    ],
    ujraProbalhato: true,
  },
  kapcsolat: {
    cim: 'A fizetés közben megszakadt a kapcsolat a bankkal.',
    pontok: [
      'A tranzakció során valószínűleg megszakadt a vonal. Próbáld meg újra.',
      'A tranzakció időtúllépés miatt sikertelen volt. Próbáld meg újra.',
    ],
    ujraProbalhato: true,
  },
  technikai: {
    cim: 'Technikai okból a bank nem fogadta el a fizetést.',
    pontok: [
      'Ha a bank fizetőoldalán a böngésző „Vissza”, „Újratöltés” vagy „Frissítés” funkcióját használtad, a rendszer a tranzakciót biztonsági okokból automatikusan visszautasítja. Indíts új fizetést.',
    ],
    ujraProbalhato: true,
  },
};

const HAROMDS: UgyfelUzenet = {
  cim: 'A kártyabirtokos-hitelesítés (3D Secure) nem sikerült.',
  pontok: [
    'A kártyádat kibocsátó bank a fizetést nem hagyta jóvá: a hitelesítés elmaradt, megszakadt vagy sikertelen volt.',
    'Próbáld újra, és a bankodtól kapott kóddal vagy a bankod alkalmazásában hagyd jóvá a fizetést.',
  ],
  ujraProbalhato: true,
};

const IDOTULLEPES: UgyfelUzenet = {
  cim: 'A fizetés időtúllépés miatt megszakadt.',
  pontok: [
    'A bank a fizetést időtúllépés miatt nem véglegesítette, ezért a kártyádat nem terheltük. Ha a bank közben zárolt összeget, azt feloldja.',
    'Próbáld meg újra.',
  ],
  ujraProbalhato: true,
};

const ALTALANOS: UgyfelUzenet = {
  cim: 'A bank nem fogadta el a fizetést.',
  pontok: ['Új fizetést bármikor indíthatsz — egy sikertelen kísérlet után nem terheljük a kártyádat.'],
  ujraProbalhato: true,
};

function normal(rc: string | null | undefined): string {
  return String(rc ?? '').trim().toUpperCase();
}

/** Az RC banki hibacsoportja; siker (00), folyamatban (PR), TO és ismeretlen kód → null. */
export function rcCsoportja(rc: string | null | undefined): RcCsoport | null {
  const k = normal(rc);
  if (!k) return null;
  for (const cs of RC_CSOPORT_SORREND) {
    if (RC_CSOPORT_KODOK[cs].includes(k)) return cs;
  }
  return null;
}

function ervenyesCsoport(v: unknown): v is RcCsoport {
  return typeof v === 'string' && (RC_CSOPORT_SORREND as readonly string[]).includes(v);
}

/**
 * A vásárlónak szóló magyarázat. Az X0 és a TO saját szöveget kap; egyébként
 * a backend `rc_csoport`-ja dönt, ennek hiányában a helyi tábla.
 */
export function ugyfelUzenet(p: { rc?: string | null; rc_csoport?: string | null }): UgyfelUzenet {
  const k = normal(p.rc);
  if (k === 'X0') return HAROMDS;
  if (k === 'TO') return IDOTULLEPES;
  const cs = ervenyesCsoport(p.rc_csoport) ? p.rc_csoport : rcCsoportja(k);
  return cs ? UZENETEK[cs] : ALTALANOS;
}
