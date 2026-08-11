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
