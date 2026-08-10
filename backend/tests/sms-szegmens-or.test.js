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

/** Legrosszabb eset: a sablonba a leghosszabb lehetséges értékeket tesszük. */
function legrosszabbHossz(sablon, nevCap) {
  return sablon
    .replace(/^`|`$/g, '')
    .replace(/\$\{[^}]*delivery_code[^}]*\}/g, '384712')
    .replace(/\$\{sofor\}/g, ` Szállító: ${'W'.repeat(nevCap)} +36301234567.`)
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

    for (const s of sablonok()) {
      const hossz = legrosszabbHossz(s, nevCap);
      expect(
        hossz,
        `Az SMS legrosszabb esete ${hossz} karakter, a 2 szegmenses határ ${KET_SZEGMENS_MAX}. `
        + 'Túllépve MINDEN fuvar SMS-e 3 szegmenses lesz (~+19 Ft/fuvar). '
        + 'Rövidítsd a szöveget vagy a név-plafont — a 14. cikk szerinti mutatót '
        + 'viszont NE vedd ki belőle.',
      ).toBeLessThanOrEqual(KET_SZEGMENS_MAX);
    }
  });
});
