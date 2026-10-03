// =====================================================================
//  CIB admin — a kézi műveletek és a szűrő tiszta logikája (2026-10-04)
//
//  A backend (cib-pr5/backend, d0e1bba) konfig NÉLKÜL is elérhető kézi
//  műveleteket kapott (POST /payments/admin/cib/:trid/kezi-rendezes:
//  konyveles / lejaratas / visszaterites), és a „lezarva" rendezés RT-je
//  opcionális lett (alapból „Tranzakció elfogadva"). Ez az őr a web oldali
//  kapukat méri: melyik művelet melyik állapotban kínálható (pontosan ott,
//  ahol a backend engedi), a mezők a backend szabályait tükrözik, és a
//  lista állapot-szűrője csak a backend által elfogadott értéket küld.
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLAPOT_SZURO, LEJARATHATO_ALLAPOTOK, adminMuveletHiba, bankiHivatkozasHiba, indoklasHiba, keziMuveletek, rtHiba,
} from './cibAdmin';

describe('keziMuveletek — csak ott, ahol a backend engedi', () => {
  it('függő + closed_ok → könyvelés (a bank lezárta, a könyvelés nem futott le)', () => {
    expect(keziMuveletek({ state: 'pending', cib_state: 'closed_ok' })).toEqual(['konyveles']);
  });

  it.each(['initializing', 'ready', 'redirected', 'authorized', 'closing'])('függő + %s → lejáratás', (cs) => {
    expect(keziMuveletek({ state: 'pending', cib_state: cs })).toEqual(['lejaratas']);
  });

  it('felülvizsgálandó + closed_ok (könyvelési árva) → visszatérítés', () => {
    expect(keziMuveletek({ state: 'needs_review', cib_state: 'closed_ok' })).toEqual(['visszaterites']);
  });

  it.each([
    [{ state: 'pending', cib_state: 'close_unknown' }, 'a kétes a „Lezárva / Nem lezárva" rendezésé'],
    [{ state: 'succeeded', cib_state: 'closed_ok' }, 'már könyvelt'],
    [{ state: 'closed', cib_state: 'closed_ok' }, 'már visszatérített'],
    [{ state: 'pending', cib_state: 'failed' }, 'végállapot'],
    [{ state: 'pending', cib_state: 'expired' }, 'végállapot'],
    [{ state: 'needs_review', cib_state: 'close_unknown' }, 'a visszatérítés csak lezárt (terhelt) tételre'],
    [{ state: undefined, cib_state: 'closed_ok' }, 'ismeretlen munkamenet-állapot'],
    [null, 'nincs session'],
  ])('%j → semmi (%s)', (s, _ok) => {
    expect(keziMuveletek(s as any)).toEqual([]);
  });

  it('a lejáratható állapotok listája a backendé', () => {
    expect([...LEJARATHATO_ALLAPOTOK]).toEqual(['initializing', 'ready', 'redirected', 'authorized', 'closing']);
  });
});

describe('a mezők a backend szabályait tükrözik', () => {
  it('indoklás: 10–2000 karakter (szóköz nélkül számolva)', () => {
    expect(indoklasHiba('rövid')).not.toBeNull();
    expect(indoklasHiba('          x         ')).not.toBeNull();
    expect(indoklasHiba('A bank levélben megerősítette.')).toBeNull();
    expect(indoklasHiba('x'.repeat(2000))).toBeNull();
    expect(indoklasHiba('x'.repeat(2001))).not.toBeNull();
  });

  it('banki hivatkozás: opcionális, legfeljebb 100 karakter, betű/szám/szóköz/. / _ -', () => {
    expect(bankiHivatkozasHiba('')).toBeNull();
    expect(bankiHivatkozasHiba('   ')).toBeNull();
    expect(bankiHivatkozasHiba('CIB-2026/10.04_ref 7')).toBeNull();
    expect(bankiHivatkozasHiba('x'.repeat(100))).toBeNull();
    expect(bankiHivatkozasHiba('x'.repeat(101))).not.toBeNull();
    expect(bankiHivatkozasHiba('ügyszám')).not.toBeNull();
    expect(bankiHivatkozasHiba('AB#12')).not.toBeNull();
  });

  it('RT: opcionális (üresen a backend alapértéke), legfeljebb 255 karakter, vezérlőkarakter nélkül', () => {
    expect(rtHiba('')).toBeNull();
    expect(rtHiba('  ')).toBeNull();
    expect(rtHiba('Tranzakció elfogadva')).toBeNull();
    expect(rtHiba('x'.repeat(255))).toBeNull();
    expect(rtHiba('x'.repeat(256))).not.toBeNull();
    expect(rtHiba('Sikeres\ttranzakció')).not.toBeNull();
    expect(rtHiba('Sikeres\u007ftranzakció')).not.toBeNull();
  });
});

describe('adminMuveletHiba — a backend kódjai saját, fix szöveget kapnak', () => {
  it.each([
    ['STATE_CHANGED', /megváltozott/],
    ['CIB_ROW_BUSY', /épp dolgozik/],
    ['CIB_DEADLINE_NOT_PASSED', /határidő/],
    ['CIB_CLOSE_NOT_SENT', /MSGT32/],
    ['CIB_UNAVAILABLE', /konfiguráció/],
    ['INVALID_VALUE', /indoklás/i],
  ])('%s', (code, minta) => {
    const u = adminMuveletHiba({ code, status: 409, message: 'nyers szerverszöveg' });
    expect(`${u.cim} ${u.szoveg}`).toMatch(minta);
    expect(`${u.cim} ${u.szoveg}`).not.toContain('nyers szerverszöveg');
  });

  it('ismeretlen hiba: általános szöveg', () => {
    const u = adminMuveletHiba(new Error('x'));
    expect(u.cim).toMatch(/nem sikerült/);
  });
});

describe('ALLAPOT_SZURO — csak a backend által elfogadott érték megy ki', () => {
  // A backend (routes/cibFizetes.js, GET /payments/admin/cib) a szűrőben a
  // nyers CIB-állapotokat (CIB_ALLAPOTOK), a „needs_review"-t és — PR-5 óta —
  // az „ellenorzes"-t fogadja el; minden más 400 „Ismeretlen állapot".
  // ⚠️ 2026-10-04: a lista eddig a felület szótárát küldte („sikeres",
  // „sikertelen", „nem_terhelt"…) — minden ilyen szűrés 400-ra futott, és az
  // admin csak egy „nem tölthetők be" hibát látott.
  const forras = fs.readFileSync(
    path.resolve(__dirname, '..', '..', '..', 'backend', 'src', 'routes', 'cibFizetes.js'), 'utf8',
  );
  const talalat = /const CIB_ALLAPOTOK = \[([^\]]*)\]/.exec(forras);
  const nyers = talalat ? [...talalat[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [];

  it('a backend nyers állapot-listája olvasható', () => {
    expect(nyers.length).toBeGreaterThanOrEqual(10);
  });

  it('minden szűrőérték a backend szótárából való', () => {
    const elfogadott = new Set([...nyers, 'needs_review', 'ellenorzes']);
    for (const o of ALLAPOT_SZURO) expect(elfogadott.has(o.ertek), `ismeretlen szűrőérték: ${o.ertek}`).toBe(true);
  });

  it('az „Egyeztetésre vár" és a felülvizsgálandó szűrő is ott van, és minden nyers állapot választható', () => {
    const ertekek = ALLAPOT_SZURO.map((o) => o.ertek);
    expect(ertekek).toContain('ellenorzes');
    expect(ertekek).toContain('needs_review');
    for (const n of nyers) expect(ertekek).toContain(n);
  });
});
