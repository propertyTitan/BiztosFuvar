// =====================================================================
//  SMS-ŐR: 14. cikk szerinti tájékoztatás, 3 szegmensen belül (2026-08-10;
//  2 → 3 szegmens: 2026-09-10, user-döntés — lásd lent)
//
//  A CSAK TELEFONSZÁMMAL megadott címzett a rendszer legvédtelenebb
//  érintettje: nincs fiókja, nem fogadott el semmit, az adatait valaki más
//  adta meg — és az e-mail nála OPCIONÁLIS, tehát az SMS az EGYETLEN
//  csatorna, amin egyáltalán megtudhatja, ki kezeli az adatait. A GDPR
//  14. cikk (3) b) szerint „legkésőbb az első közléskor" tájékoztatni kell.
//
//  A tájékoztatás ugyanakkor NEM kerülhet pénzbe: a szöveg ékezetes (UCS-2),
//  ahol egy összefűzött szegmens 67 karakter. Egy karakterrel túllépve a
//  küldés egy szegmenssel drágább (~+19 Ft MINDEN fuvaron).
//
//  ⚠️ 2026-09-10 (user-döntés): a plafon 2 → 3 szegmens. A címzett eddig
//  nem tudta meg, hogy a kódot CSAK átadáskor szabad kimondania — előre
//  bediktálva a kód elveszti a bizonyíték-értékét. A mondat nem fért a 134
//  karakterbe; a +19 Ft/fuvar vállalt ár. Az őr ezért kettőt tart: a
//  3-as plafont ÉS hogy a „csak az átadáskor” mondat benne legyen.
//
//  Ez az őr a kettőt EGYSZERRE tartja: legyen benne a mutató, és férjen bele.
//  Enélkül a következő szövegmódosítás vagy a tájékoztatást ejtené, vagy
//  némán megdrágítaná az üzemeltetést.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// UCS-2 (ékezetes) SMS: 70 kar egy szegmensben, összefűzve 67/szegmens.
const HAROM_SZEGMENS_MAX = 201;

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
    // KIVÉTEL (2026-08-30): az újraküldő kör nem FOGALMAZ SMS-t, hanem egy
    // MÁR MEGMÉRT sablon tárolt másolatát küldi tovább változatlanul — új
    // szegmens-költség nem keletkezhet. Hogy a kivétel ne lazulhasson fel,
    // külön teszt őrzi, hogy a továbbítás tényleg szó szerinti (lásd lent).
    if (rel === 'services/smsRetry.js') continue;
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
  it('a kivételezett újraküldő kör NEM fogalmaz szöveget (szó szerinti továbbítás)', () => {
    // A smsRetry.js ki van véve a sablon-mérés alól azzal az indokkal, hogy
    // csak tárolt (már megmért) üzenetet továbbít. Ez a teszt tartja igaznak
    // az indokot: ha ott valaha új szöveg-összefűzés jelenne meg a küldésben,
    // az őr újra pirosra vált, és a fájlt vissza kell venni a mérés alá.
    const forras = readFileSync(`${SRC_DIR}/services/smsRetry.js`, 'utf8');
    expect(
      /sendSms\(row\.phone,\s*row\.message,/.test(forras),
      'A smsRetry.js sendSms-hívása már nem szó szerint továbbítja a tárolt '
      + 'üzenetet (row.phone, row.message) — a szegmens-mérés alóli kivétele '
      + 'így nem indokolható: vedd vissza a fájlt a sablon-mérés alá.',
    ).toBe(true);
  });

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

  it('a kódot CSAK átadáskor szabad kimondani — ez benne van a szövegben', () => {
    // 2026-09-10: e mondat nélkül a címzett előre bediktálhatja a kódot
    // (telefonban, üzenetben), és a lezárás bizonyíték-értéke elvész.
    for (const s of sablonok()) {
      expect(
        s,
        'A felvételkori SMS nem mondja meg a címzettnek, hogy a kódot csak az '
        + 'átadáskor adja meg — ezért fizetjük a 3. szegmenst, ne vesszen ki.',
      ).toMatch(/csak az átadáskor add meg/);
    }
  });

  it('a legrosszabb eset is 3 szegmensen belül marad (nem drágul tovább az üzem)', () => {
    const telHossz = telefonMaxHossz();
    for (const { fajl, sablon, nevCap } of kuldesek()) {
      expect(nevCap, `nem találtam név-plafont a ${fajl}-ban`).toBeGreaterThan(0);
      const hossz = legrosszabbHossz(sablon, nevCap, telHossz);
      expect(
        hossz,
        `Az SMS legrosszabb esete ${hossz} karakter, a 3 szegmenses határ ${HAROM_SZEGMENS_MAX}. `
        + 'Túllépve MINDEN fuvar SMS-e 4 szegmenses lesz (~+19 Ft/fuvar). '
        + `(A számítás a TÉNYLEGESEN engedélyezett ${telHossz} karakteres telefonszámmal `
        + 'megy, nem egy szép, rövid példával — egy szóközös magyar formázás is belefér.)\n'
        + 'Rövidítsd a szöveget, a név-plafont, vagy VÁGD a telefonszámot a sablonban — '
        + 'a 14. cikk szerinti mutatót viszont NE vedd ki belőle.',
      ).toBeLessThanOrEqual(HAROM_SZEGMENS_MAX);
    }
  });
});
