// =====================================================================
//  EXPORT-TELJESSÉG ŐR (2026-08-11)
//
//  ⚠️ A GDPR 15. és 20. cikkes adatexport az EGYETLEN érintetti jog, ami
//  eddig kézi éberségen állt. A projektben van osztály-teszt a TÚL-kiadás
//  ellen (scrub-ALLOWLIST: kívülálló pontosan a felsorolt mezőket kaphatja),
//  de az ALUL-kiadás ellen semmi — pedig a gomb felirata („Adataim
//  letöltése") és a végpont kommentje is TELJESSÉGET állít.
//
//  A független mérés hat kimaradt táblát talált (útvonal-figyelők, viták,
//  kérdések, SOS, admin-levelezés, push-tokenek) és a DAC7-mezőket. Ez az őr
//  a SÉMA felől ellenőrzi: minden felhasználóhoz köthető tábla vagy szerepel
//  az exportban, vagy írásos indoklással a kivétel-listán.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const { db } = require('./helpers');

const EXPORT_FORRAS = readFileSync(`${__dirname}/../src/routes/auth.js`, 'utf8')
  .slice(
    readFileSync(`${__dirname}/../src/routes/auth.js`, 'utf8').indexOf("router.get('/me/export'"),
  ).slice(0, 6000);

// Miért nem kell egy tábla az exportba — indoklás kötelező.
const KIVETELEK = {
  users: 'a profil-lekérdezés adja vissza, mezőnként válogatva (jelszó-hash és tokenek nélkül)',
  photos: 'a fuvar/foglalás rekordok tartalmazzák a hivatkozást; a nyers fájlokat kérésre adjuk ki',
  location_pings: '7 nap után törlődik; a nyers GPS-pont nem hordoz többletet a fuvar-rekordhoz képest',
  kyc_doc_history: 'kizárólag HMAC-lenyomat, személyhez nem köthető vissza — nem az érintett adata',
  deleted_accounts: 'a fiók törlése UTÁN keletkezik; élő felhasználóra nem vonatkozik',
  admin_access_log: 'az ADMINISZTRÁTOR tevékenységének naplója, nem a felhasználó adata',
  admin_broadcasts: 'a platform által küldött körüzenetek naplója; a felhasználó példányát az admin_messages adja',
  retention_runs: 'a retenciós körök futás-naplója, személyes adat nélkül',
  escrow_transactions: 'a fizetés technikai nyoma; az érintett számára a számla és a fuvar-rekord a releváns',
  payment_events: 'ugyanaz, technikai fizetési napló',
  carrier_route_prices: 'a járat szakasz-árazása, nem személyes adat',
  user_badges: 'jelvény-hivatkozás; a szintet a profil tartalmazza',
  reviews: 'az exportban szerepel (ertekeleseim + rolam_szolo_ertekelesek)',
  messages: 'az exportban szerepel (uzeneteim)',
  jobs: 'az exportban szerepel (feladott_fuvarok + vallalt_fuvarok)',
  bids: 'az exportban szerepel (ajanlataim)',
  carrier_routes: 'az exportban szerepel (jarataim)',
  route_bookings: 'az exportban szerepel (foglalasaim)',
  notifications: 'az exportban szerepel (ertesiteseim)',
  invoices: 'az exportban szerepel (szamlaim)',
  kyc_documents: 'az exportban szerepel (kyc_metaadat)',
  fee_vouchers: 'az exportban szerepel (kuponjaim)',
  carrier_alerts: 'az exportban szerepel (utvonal_figyeloim)',
  job_questions: 'az exportban szerepel (kerdeseim)',
  disputes: 'az exportban szerepel (vitaim)',
  sos_events: 'az exportban szerepel (veszjelzeseim)',
  admin_messages: 'az exportban szerepel (gofuvar_uzenetvaltas)',
  push_tokens: 'az exportban szerepel (ertesitesi_eszkozeim)',
  tow_requests: 'a mentés-funkció kikapcsolva (TOWING_ENABLED); élesedéskor felveendő',
};

describe('Export-teljesség őr', () => {
  it('minden felhasználóhoz köthető tábla szerepel az exportban vagy a kivétel-listán', async () => {
    // Csak azok a táblák érdekesek, amiknek van a user-re mutató oszlopuk.
    const { rows } = await db.query(
      `SELECT DISTINCT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_name = c.table_name AND t.table_schema = 'public'
        WHERE c.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
          AND c.column_name IN ('user_id','carrier_id','shipper_id','uploader_id',
                                'sender_id','reviewer_id','opened_by','asker_id',
                                'buyer_user_id','original_user_id','requester_id','admin_id')
        ORDER BY 1`,
    );
    const tablak = rows.map((r) => r.table_name);
    expect(tablak.length, 'nem sikerült kiolvasni a táblákat — az őr vak').toBeGreaterThan(10);

    const hianyzo = tablak.filter((t) => !KIVETELEK[t]);
    expect(
      hianyzo,
      `Ezek a táblák felhasználói adatot tartalmaznak, de nincsenek elszámolva az `
      + `exportban:\n  ${hianyzo.join('\n  ')}\n\n`
      + 'Vagy vedd bele a GET /auth/me/export válaszába, vagy írd meg a '
      + 'KIVETELEK listában, MIÉRT nem az érintett adata. A gomb felirata '
      + 'teljességet ígér — egy 15. cikkes kérésre hiányos válasz jogsértés.',
    ).toEqual([]);
  });

  it('a DAC7 és a fiókhasználati mezők benne vannak a profil-lekérdezésben', () => {
    for (const mezo of ['personal_tax_id', 'birth_date', 'login_count', 'total_active_seconds']) {
      expect(
        EXPORT_FORRAS.includes(mezo),
        `A(z) "${mezo}" hiányzik az exportból, pedig a tájékoztató 2. szakasza `
        + 'tételesen felsorolja kezelt adatként.',
      ).toBe(true);
    }
  });
});

// =====================================================================
//  AZ „EXPORTBAN SZEREPEL" ÁLLÍTÁSOK FUTTATVA (2026-08-11, 8. mérés Ő3)
//
//  ⚠️ AZ ŐR EDDIG A SAJÁT ÁLLÍTÁSÁT HITTE EL. A KIVETELEK 16 bejegyzése szó
//  szerint azt mondja: „az exportban szerepel (vitaim)" — de a teszt csak
//  annyit nézett, hogy VAN-E bejegyzés, nem azt, hogy IGAZ-E. Ellenpélda:
//  töröld a `vitaim:` blokkot az auth.js-ből → a `disputes` benne marad a
//  kivétel-listán → ZÖLD BUILD, miközben egy 15. cikkes kérésre a
//  legterheltebb szöveg (kit mivel vádolnak) kimarad a válaszból.
//
//  Ez a teszt a valódi végpontot hívja meg, és megköveteli, hogy minden
//  ígért kulcs TÉNYLEGESEN ott legyen a válaszban.
// =====================================================================
describe('Export — az ígért kulcsok tényleg a válaszban vannak', () => {
  it('minden „az exportban szerepel (X)" állítás igaz', async () => {
    const request = require('supertest');
    const { app, createUser } = require('./helpers');

    const user = await createUser({ role: 'shipper' });
    const res = await request(app)
      .get('/auth/me/export')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status, 'az export-végpont nem válaszolt — a teszt nem mér semmit').toBe(200);

    // A kivétel-indoklásokból kiszedjük a zárójeles kulcsokat:
    //   'az exportban szerepel (ertekeleseim + rolam_szolo_ertekelesek)'
    const igertKulcsok = [];
    for (const [tabla, indok] of Object.entries(KIVETELEK)) {
      if (typeof indok !== 'string' || !indok.includes('az exportban szerepel')) continue;
      const m = indok.match(/\(([^)]+)\)/);
      if (!m) continue;
      for (const k of m[1].split('+').map((x) => x.trim())) {
        igertKulcsok.push([tabla, k]);
      }
    }
    expect(igertKulcsok.length, 'nem találtam ígért kulcsokat — az őr vak').toBeGreaterThan(10);

    const hianyzo = igertKulcsok
      .filter(([, kulcs]) => !(kulcs in res.body))
      .map(([tabla, kulcs]) => `${tabla} → "${kulcs}" (ez a kulcs NINCS a válaszban)`);

    // ⚠️ A KULCS LÉTEZÉSE NEM ELÉG (2026-08-11, 9. mérés Ő6). A korábbi
    // változat csak azt nézte, hogy `kulcs in res.body` — vagyis egy üres
    // tömböt vagy egy szűkített (pl. „csak az utolsó 30 nap") lekérdezést is
    // elfogadott volna, miközben a 15. cikkes válasz hiányos. Ezért a lista
    // TÍPUSÁT is megköveteljük: ami gyűjtemény, az tömb legyen — így egy
    // `null`-ra vagy objektumra csúszó blokk kiderül.
    const rosszTipus = igertKulcsok
      .filter(([, kulcs]) => kulcs in res.body && !Array.isArray(res.body[kulcs]))
      .map(([tabla, kulcs]) => `${tabla} → "${kulcs}" nem tömb (${typeof res.body[kulcs]})`);
    expect(
      rosszTipus,
      `Az export ígért gyűjteményei nem tömbök:\n  ${rosszTipus.join('\n  ')}\n\n`
      + 'Egy 15. cikkes kérésre a hiányos vagy rossz alakú válasz jogsértés.',
    ).toEqual([]);

    expect(
      hianyzo,
      `A kivétel-lista olyan kulcsokra hivatkozik, amik nincsenek az exportban:\n  ${hianyzo.join('\n  ')}\n\n`
      + 'Vagy a blokk esett ki az auth.js-ből (ekkor a 15. cikkes válasz hiányos),\n'
      + 'vagy a kulcsot átnevezték és a kivétel-indoklás avult el. Mindkettő\n'
      + 'tudatos döntést kíván — az őr nem hiheti el a saját állítását.',
    ).toEqual([]);
  });
});

// =====================================================================
//  AZ EXPORT NYOMOT HAGY (2026-08-11, adatáramlási audit)
//
//  A végpont a teljes személyes adat-dumpot adja PUSZTA bearer-tokenre:
//  adóazonosító jel, születési dátum, minden cím, chat, számlák — jelszó-
//  újrakérés nélkül. Egy ellopott JWT egyetlen kéréssel mindent kivisz.
//  A jelszó-újrakérés a mi flow-nkban nem járható (a token az egyetlen
//  bizonyíték), a NÉMASÁG viszont igen: az exportról a felhasználó értesül.
// =====================================================================
describe('Export — a felhasználó értesül róla', () => {
  it('az adatexport értesítést hagy a fiókban', async () => {
    const request = require('supertest');
    const { app, db, createUser } = require('./helpers');

    const user = await createUser({ role: 'shipper' });
    const res = await request(app)
      .get('/auth/me/export')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);

    // Az értesítés fire-and-forget — rövid várakozás a beírásra.
    await new Promise((r) => { setTimeout(r, 150); });
    const { rows } = await db.query(
      `SELECT type, title FROM notifications WHERE user_id = $1 AND type = 'security'`,
      [user.id],
    );
    expect(
      rows.length,
      'Az adatexport NEM hagyott nyomot a felhasználó felé.\n'
      + 'Egy ellopott tokennel így némán kivihető a teljes személyes adat-dump\n'
      + '(adóazonosító jel, születési dátum, chat, számlák), és a felhasználó\n'
      + 'soha nem tudja meg. Az értesítés az egyetlen jelzésünk.',
    ).toBeGreaterThan(0);
  });
});
