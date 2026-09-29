import { describe, it, expect } from 'vitest';
import { RC_CSOPORT_KODOK, rcCsoportja, ugyfelUzenet, BANKI_TOVABBI_INFO } from './cibRcCsoport';

// A CIB „Fejlesztési javaslatok" — Tranzakciós hibakódok: a MSGT32-re adott
// MSGT31 kódjaiból a bank NÉGY csoportot képzett, mindegyikhez saját
// ügyfél-figyelmeztetéssel. A listát betűre rögzítjük, hogy egy „rendrakás"
// ne vihesse át némán egy kódot másik csoportba.
describe('CIB RC-csoportok', () => {
  it('a négy csoport kódjai a banki listával egyeznek', () => {
    expect(RC_CSOPORT_KODOK.kartya).toEqual([
      '03', '09', '12', '13', '20', '21', '22', '30', '34', '36', '42', '52', '54', '55', '56', '87', '88', '90', 'X3',
    ]);
    expect(RC_CSOPORT_KODOK.szamla).toEqual([
      '14', '15', '16', '17', '23', '24', '29', '32', '35', '45', '69', '70', '72', '74', '75', '76', '77', '78',
    ]);
    expect(RC_CSOPORT_KODOK.kapcsolat).toEqual([
      '08', '10', '19', '27', '31', '50', '60', '64', '65', '71', '86', '93', 'A2', 'A9',
    ]);
    expect(RC_CSOPORT_KODOK.technikai).toEqual([
      '01', '02', '04', '05', '06', '07', '11', '18', '25', '26', '28', '33', '38', '39', '40', '41', '43', '44', '46', '49', '51',
      '53', '57', '61', '62', '63', '66', '67', '79', '80', '81', '85', '92', '94', '96', '98', 'R0', 'C2', 'X0', 'X1', 'X2', 'X3',
      'NT',
    ]);
  });

  it.each([
    ['05', 'technikai'], ['51', 'technikai'], ['NT', 'technikai'],
    ['12', 'kartya'], ['54', 'kartya'],
    ['16', 'szamla'], ['76', 'szamla'],
    ['08', 'kapcsolat'], ['A9', 'kapcsolat'],
  ])('%s → %s', (rc, csoport) => {
    expect(rcCsoportja(rc)).toBe(csoport);
  });

  it('az X3 a banki listán KÉT csoportban is szerepel — az első (kártya) nyer', () => {
    expect(rcCsoportja('X3')).toBe('kartya');
  });

  it('kis- és nagybetű, szóköz nem számít', () => {
    expect(rcCsoportja(' x0 ')).toBe('technikai');
    expect(rcCsoportja('a2')).toBe('kapcsolat');
  });

  it('a siker (00), a folyamatban (PR), az időtúllépés (TO) és az ismeretlen kód nem hibacsoport', () => {
    expect(rcCsoportja('00')).toBeNull();
    expect(rcCsoportja('PR')).toBeNull();
    expect(rcCsoportja('TO')).toBeNull();
    expect(rcCsoportja('ZZ')).toBeNull();
    expect(rcCsoportja(null)).toBeNull();
    expect(rcCsoportja(undefined)).toBeNull();
  });
});

describe('ügyfélüzenet csoportonként', () => {
  it('kártya jellegű hiba: a bank hat ellenőrző pontja', () => {
    const u = ugyfelUzenet({ rc: '54' });
    expect(u.pontok).toHaveLength(6);
    expect(u.pontok.join(' ')).toMatch(/kártyaszám/);
    expect(u.pontok.join(' ')).toMatch(/lejárati dátum/);
    expect(u.pontok.join(' ')).toMatch(/CVC/);
    expect(u.pontok.join(' ')).toMatch(/CVV/);
    expect(u.pontok.join(' ')).toMatch(/internetes vásárlásra/);
  });

  it('számla jellegű hiba: fedezet és limit', () => {
    const u = ugyfelUzenet({ rc: '51', rc_csoport: 'szamla' });
    expect(u.pontok.join(' ')).toMatch(/elegendő pénz/);
    expect(u.pontok.join(' ')).toMatch(/limit/);
  });

  it('kapcsolati jellegű hiba: megszakadt vonal, időtúllépés, próbáld újra', () => {
    const u = ugyfelUzenet({ rc: '08' });
    expect(u.pontok.join(' ')).toMatch(/megszakadt a vonal/);
    expect(u.pontok.join(' ')).toMatch(/időtúllépés/);
    expect(u.ujraProbalhato).toBe(true);
  });

  it('technikai jellegű hiba: a Vissza/Frissítés miatti automatikus visszautasítás', () => {
    const u = ugyfelUzenet({ rc: '96' });
    expect(u.pontok.join(' ')).toMatch(/Vissza/);
    expect(u.pontok.join(' ')).toMatch(/Frissítés/);
    expect(u.pontok.join(' ')).toMatch(/biztonsági okokból automatikusan visszautasítja/);
  });

  it('a backend rc_csoport-ja erősebb a helyi táblánál', () => {
    // A backend-tükör dönt (ugyanabból a banki listából), a web csak tartalék.
    expect(ugyfelUzenet({ rc: '96', rc_csoport: 'kartya' }).cim)
      .toBe(ugyfelUzenet({ rc: '54' }).cim);
  });

  it('X0 = sikertelen 3D Secure hitelesítés, külön magyarázattal', () => {
    const u = ugyfelUzenet({ rc: 'X0', rc_csoport: 'technikai' });
    expect(u.cim).toMatch(/3D Secure/);
    expect(u.pontok.join(' ')).toMatch(/kibocsát/);
    expect(u.ujraProbalhato).toBe(true);
  });

  it('TO = időtúllépés: nem terheltünk, újra próbálható', () => {
    const u = ugyfelUzenet({ rc: 'TO' });
    expect(u.cim).toMatch(/időtúllépés/i);
    expect(u.pontok.join(' ')).toMatch(/nem terheltük/);
    expect(u.ujraProbalhato).toBe(true);
  });

  it('ismeretlen kód: általános, nem ijesztő szöveg, soha üres', () => {
    const u = ugyfelUzenet({ rc: 'ZZ' });
    expect(u.cim.length).toBeGreaterThan(5);
    expect(u.pontok.length).toBeGreaterThan(0);
  });

  it('a számlavezető bankhoz irányító mondat a bank tájékoztatójából jön', () => {
    expect(BANKI_TOVABBI_INFO).toMatch(/számlavezető bank/);
  });
});
