// =====================================================================
//  MOCK-CSAPDA ŐR: a vi.spyOn().mockRejectedValue() nem mér elutasítást
//  (2026-08-12)
//
//  ⚠️ KÉT ÜGYNÖK TALÁLTA MEG EGYMÁSTÓL FÜGGETLENÜL, UGYANAZON A NAPON —
//  ez repó-szintű csapda, nem egyedi hiba.
//
//  A minta, ami VAKON ZÖLD tesztet szül:
//
//      vi.spyOn(modul, 'fn').mockRejectedValue(new Error('x'));
//      // …majd azt állítjuk, hogy nem lett „unhandled rejection"
//
//  A vitest a mock által visszaadott ígéretre BELSŐLEG rákapcsolódik
//  (`mock.settledResults`), ezért az SOHA nem minősül kezeletlennek. Vagyis a
//  „fire-and-forget hiba nem hagyhat kezeletlen elutasítást" típusú teszt a
//  mockkal MEGÍRHATATLAN: akkor is zöld, ha a `.catch()` eltűnik a termékkódból.
//
//  Két ügynök is lemérte: a `.catch()` törlése után a spy-os teszt VÉGIG ZÖLD
//  maradt; nyers, kézi metódus-cserével (`modul.fn = async () => { throw … }`)
//  ugyanaz a regresszió azonnal pirosra vált.
//
//  Ez a fájl magát a csapdát bizonyítja — hogy dokumentált, mért tény legyen,
//  és a jövőbeli tesztíró (ember vagy ügynök) ne essen bele újra.
// =====================================================================
import {
  describe, it, expect, vi, afterEach,
} from 'vitest';

const modul = {
  async elszall() { return 'ok'; },
};

/** Egy „fire-and-forget" hívás, ahogy a termékkódban is: .catch() NÉLKÜL. */
function tuzesElfelejt() {
  modul.elszall();
}

/** Ugyanaz, de kezelt hibával. */
function tuzesElfelejtKezelve() {
  modul.elszall().catch(() => {});
}

/** Kezeletlen ígéret-elutasítások gyűjtése egy rövid ablakban. */
async function kezeletlenek(muvelet) {
  const talalt = [];
  const figyelo = (ok) => talalt.push(ok);
  process.on('unhandledRejection', figyelo);
  try {
    muvelet();
    // Két makrotaszk-forduló, hogy a Node kimondja az ítéletet.
    await new Promise((r) => { setTimeout(r, 60); });
  } finally {
    process.off('unhandledRejection', figyelo);
  }
  return talalt.length;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('Mock-csapda: a spy elnyeli az elutasítást', () => {
  it('vi.spyOn().mockRejectedValue() NEM ad kezeletlen elutasítást (a csapda)', async () => {
    vi.spyOn(modul, 'elszall').mockRejectedValue(new Error('szimulált hiba'));
    const db = await kezeletlenek(tuzesElfelejt);

    expect(
      db,
      'A vitest-mock MÉGIS kezeletlen elutasítást adott. Ha ez pirosra vált, a\n'
      + 'vitest viselkedése megváltozott — ilyenkor a repó összes ilyen tesztje\n'
      + 'újraértékelendő (eddig a mock ELNYELTE az elutasítást, ezért a\n'
      + '„fire-and-forget hibája nem szabadulhat el" tesztek vakon zöldek voltak).',
    ).toBe(0);
  });

  it('NYERS metódus-csere VISZONT ad — így kell mérni', async () => {
    const eredeti = modul.elszall;
    modul.elszall = async () => { throw new Error('szimulált hiba'); };
    try {
      const db = await kezeletlenek(tuzesElfelejt);
      expect(
        db,
        'A nyers metódus-csere sem adott kezeletlen elutasítást — ekkor a\n'
        + 'mérési módszer maga romlott el, és EGYETLEN ilyen tesztünk sem véd.',
      ).toBeGreaterThan(0);
    } finally {
      modul.elszall = eredeti;
    }
  });

  it('a kezelt (.catch-es) hívás nyers cserével sem szivárog', async () => {
    const eredeti = modul.elszall;
    modul.elszall = async () => { throw new Error('szimulált hiba'); };
    try {
      const db = await kezeletlenek(tuzesElfelejtKezelve);
      expect(
        db,
        'A `.catch()`-csel ellátott hívás is kezeletlen elutasítást adott — '
        + 'a mérés hamis riasztást ad, tehát használhatatlan.',
      ).toBe(0);
    } finally {
      modul.elszall = eredeti;
    }
  });
});
