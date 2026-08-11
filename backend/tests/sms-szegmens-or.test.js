// =====================================================================
//  SMS-ŐR: 14. cikk szerinti tájékoztatás, 2 szegmensen belül (2026-08-10)
//
//  A CSAK TELEFONSZÁMMAL megadott címzett a rendszer legvédtelenebb
//  érintettje: nincs fiókja, nem fogadott el semmit, az adatait valaki más
//  adta meg — és az e-mail nála OPCIONÁLIS, tehát az SMS az EGYETLEN
//  csatorna, amin egyáltalán megtudhatja, ki kezeli az adatait. A GDPR
//  14. cikk (3) b) szerint „legkésőbb az első közléskor" tájékoztatni kell.
//
//  A tájékoztatás ugyanakkor NEM kerülhet pénzbe: a szöveg ékezetes (UCS-2),
//  ahol 2 összefűzött szegmens = 134 karakter. Egy karakterrel túllépve a
//  küldés 3 szegmenssé válik (~+19 Ft MINDEN fuvaron).
//
//  Ez az őr a kettőt EGYSZERRE tartja: legyen benne a mutató, és férjen bele.
//  Enélkül a következő szövegmódosítás vagy a tájékoztatást ejtené, vagy
//  némán megdrágítaná az üzemeltetést.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// UCS-2 (ékezetes) SMS: 70 kar egy szegmensben, összefűzve 67/szegmens.
const KET_SZEGMENS_MAX = 134;

const FORRAS = readFileSync(`${__dirname}/../src/routes/photos.js`, 'utf8');

/** A felvételkori SMS-ek sablonjai a forrásból. */
function sablonok() {
  return [...FORRAS.matchAll(/`GoFuvar: úton a csomagod![^`]*`/g)].map((m) => m[0]);
}

/**
 * A TÉNYLEGESEN engedélyezett leghosszabb telefonszám — a `cleanPhone`
 * felső korlátjából olvasva (routes/auth.js), NEM beégetve.
 *
 * ⚠️ 2026-08-11: ez az őr korábban a `+36301234567` alakot égette be (12
 * karakter), és zöld maradt — miközben a `cleanPhone` 30 karakterig,
 * SZÓKÖZZEL és kötőjellel is elfogad. Egy teljesen szokványos magyar
 * formázás (`+36 30 123 4567`) már 135 karakteres üzenetet ad, vagyis
 * 3 szegmenst és ~+19 Ft-ot MINDEN fuvaron. Az őr saját ígérete („nem
 * drágul némán az üzem") így nem teljesült.
 */
function telefonMaxHossz() {
  const auth = readFileSync(`${__dirname}/../src/routes/auth.js`, 'utf8');
  // A sablon NORMALIZÁL (csak számjegy és '+'), ezért a mértékadó korlát a
  // számjegyek felső határa, nem a nyers string hossza. Ha a sablonból
  // eltűnne a normalizálás, ez a szám alábecsülne — ezért külön ellenőrizzük.
  const forras = readFileSync(`${__dirname}/../src/routes/photos.js`, 'utf8');
  const normalizal = /replace\(\/\[\^\\d\+\]\/g, ''\)/.test(forras);
  if (!normalizal) {
    throw new Error(
      'A felvételkori SMS már NEM normalizálja a telefonszámot. A cleanPhone '
      + 'szóközzel/kötőjellel 30 karakterig enged — normalizálás nélkül egy '
      + 'szokványos magyar formázás 3 szegmensbe viszi az üzenetet. Vagy tedd '
      + 'vissza a normalizálást, vagy igazítsd ezt az őrt a nyers hosszra.',
    );
  }
  const m = auth.match(/digits\.length > (\d+)/);
  if (!m) {
    throw new Error(
      'Nem találom a cleanPhone számjegy-korlátját a routes/auth.js-ben. Az őr '
      + 'így BEÉGETETT feltevéssel mérne — pontosan az a hiba, ami miatt ez a '
      + 'függvény létrejött. Igazítsd a mintát a valós kódhoz.',
    );
  }
  return Number(m[1]) + 1; // a vezető '+'
}

/** Legrosszabb eset: a sablonba a leghosszabb lehetséges értékeket tesszük. */
function legrosszabbHossz(sablon, nevCap, telHossz) {
  return sablon
    .replace(/^`|`$/g, '')
    .replace(/\$\{[^}]*delivery_code[^}]*\}/g, '384712')
    .replace(/\$\{sofor\}/g, ` Szállító: ${'W'.repeat(nevCap)} ${'9'.repeat(telHossz)}.`)
    .length;
}

describe('Felvételkori SMS a címzettnek', () => {
  it('mindkét ág (fuvar + foglalás) sablonja megvan', () => {
    expect(sablonok().length, 'nem találtam a felvételkori SMS-sablonokat — az őr vak').toBe(2);
  });

  it('tartalmazza a GDPR 14. cikk szerinti mutatót', () => {
    for (const s of sablonok()) {
      expect(
        s,
        'a csak telefonszámmal megadott címzett SEMMILYEN tájékoztatást nem kap arról, '
        + 'ki kezeli az adatait — pedig ez nála az egyetlen csatorna',
      ).toMatch(/gofuvar\.hu\/a/);
    }
  });

  it('a legrosszabb eset is 2 szegmensen belül marad (nem drágul az üzem)', () => {
    // A név-plafont a forrásból olvassuk ki, hogy a teszt ne csússzon el tőle.
    const capok = [...FORRAS.matchAll(/\.slice\(0,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    const nevCap = Math.max(...capok);
    expect(nevCap, 'nem találtam a név-plafont a forrásban').toBeGreaterThan(0);

    const telHossz = telefonMaxHossz();
    for (const s of sablonok()) {
      const hossz = legrosszabbHossz(s, nevCap, telHossz);
      expect(
        hossz,
        `Az SMS legrosszabb esete ${hossz} karakter, a 2 szegmenses határ ${KET_SZEGMENS_MAX}. `
        + 'Túllépve MINDEN fuvar SMS-e 3 szegmenses lesz (~+19 Ft/fuvar). '
        + `(A számítás a TÉNYLEGESEN engedélyezett ${telHossz} karakteres telefonszámmal `
        + 'megy, nem egy szép, rövid példával — egy szóközös magyar formázás is belefér.)\n'
        + 'Rövidítsd a szöveget, a név-plafont, vagy VÁGD a telefonszámot a sablonban — '
        + 'a 14. cikk szerinti mutatót viszont NE vedd ki belőle.',
      ).toBeLessThanOrEqual(KET_SZEGMENS_MAX);
    }
  });
});
