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

// ⚠️ MINDEN route-fájl (2026-08-11). Az őr korábban CSAK a photos.js-t
// olvasta, és a sablont a „GoFuvar: úton a csomagod!" nyitómondathoz kötötte
// — egy másik fájlból küldött, más szövegű címzetti SMS-re teljesen vak volt.
// Pedig épp az a mérce, hogy „a címzett EGYETLEN csatornája".
// ⚠️ A TELJES `src` FÁT JÁRJUK (2026-08-11, 8. mérés Ő5). Korábban csak a
// `src/routes` alatt kerestünk, ezért egy service-ből (pl. notifications.js,
// retention.js) küldött címzetti SMS-t az őr NEM LÁTOTT — sem a 14. cikkes
// mutatót, sem a szegmens-hosszt nem mérte rajta. A védelem a HELYRE épült,
// nem a viselkedésre; ez pontosan az a minta, amit ez a kör több helyen is
// megtalált.
const SRC_DIR = `${__dirname}/../src`;
function smsKuldoFajlok(mappa = SRC_DIR, elotag = '') {
  const { readdirSync } = require('fs');
  const ki = [];
  for (const b of readdirSync(mappa, { withFileTypes: true })) {
    const ut = `${mappa}/${b.name}`;
    const rel = elotag ? `${elotag}/${b.name}` : b.name;
    if (b.isDirectory()) { ki.push(...smsKuldoFajlok(ut, rel)); continue; }
    if (!b.name.endsWith('.js')) continue;
    const forras = readFileSync(ut, 'utf8');
    // HÍVÁST keresünk, nem DEKLARÁCIÓT: a services/sms.js maga definiálja a
    // függvényt (`async function sendSms(to, message)`), az nem küldés.
    const hivasok = forras.replace(/(?:async\s+)?function\s+sendSms\s*\(/g, '');
    if (hivasok.includes('sendSms(')) ki.push({ nev: rel, forras });
  }
  return ki;
}
const ROUTE_FAJLOK = smsKuldoFajlok();
const FORRAS = ROUTE_FAJLOK.map((x) => x.forras).join('\n');

/** A felvételkori SMS-ek sablonjai a forrásból. */
/**
 * Minden SMS-küldés: a sablon ÉS a hozzá tartozó fájl név-plafona.
 * ⚠️ A plafont FÁJLONKÉNT olvassuk — ha az összes route `.slice()`-át
 * néznénk, egy másik fájl hosszabb vágása némán elrontaná a számítást.
 */
function kuldesek() {
  const out = [];
  for (const { nev, forras } of ROUTE_FAJLOK) {
    const capok = [...forras.matchAll(/\.slice\(0,\s*(\d+)\)/g)].map((m) => Number(m[1]));
    const nevCap = capok.length ? Math.max(...capok) : 0;
    for (const m of forras.matchAll(/sendSms\([^,]+,\s*(`[^`]*`)/g)) {
      out.push({ fajl: nev, sablon: m[1], nevCap });
    }
  }
  return out;
}

function sablonok() {
  return kuldesek().map((k) => k.sablon);
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
  it('minden SMS-küldés sablonja megtalálható', () => {
    const hivasok = (FORRAS.match(/sendSms\(/g) || []).length;
    expect(hivasok, 'nem találtam sendSms hívást — az őr vak').toBeGreaterThan(0);
    expect(
      sablonok().length,
      `${hivasok} sendSms hívás van, de csak ${sablonok().length} sablont ismertem fel. `
      + 'Ha egy küldés nem template-literállal megy, az őr NEM méri — írd át, '
      + 'vagy igazítsd a felismerést.',
    ).toBe(hivasok);
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
    const telHossz = telefonMaxHossz();
    for (const { fajl, sablon, nevCap } of kuldesek()) {
      expect(nevCap, `nem találtam név-plafont a ${fajl}-ban`).toBeGreaterThan(0);
      const hossz = legrosszabbHossz(sablon, nevCap, telHossz);
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
