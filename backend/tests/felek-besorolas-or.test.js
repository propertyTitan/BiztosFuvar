// =====================================================================
//  A „FELEK" BESOROLÁS MÉRVE, NEM ÁLLÍTVA (2026-08-12, 10. mérés Ő2)
//
//  ⚠️ A KÖR META-TALÁLATA: az őrök megtanultak MÉRNI (Express router-stack,
//  information_schema, valódi végpont-hívás) — de azt, hogy MIT mérjenek,
//  továbbra is egy KÉZZEL ÍRT CÍMKE döntötte el, amit senki nem ellenőrzött.
//
//  A `masok` besorolású végpontokon az őr futásidőben követeli a kaput. A
//  `felek` besorolásúakra RÁ SEM NÉZ — abban a hitben, hogy ott a handler
//  saját jogosultság-ellenőrzése véd. Két címke MA HAMIS volt:
//
//    * `GET /jobs/:jobId/photos` = 'felek' — valójában a NEM-FÉLNEK is adta a
//      NYERS photos sort (uploader_id → publikus profil → NÉV, GPS-koordináta,
//      taken_at), e-mail-kapu nélkül, bármilyen státuszú fuvarra.
//    * `GET /carrier-routes/:id` kivétel-indoklása („csak azt adja, amit a
//      feladó úgyis lát") nem volt igaz a draft/lemondott/sablon járatokra.
//
//  Ez a teszt a címkét VISELKEDÉSSÉ fordítja: minden `felek` végpontot
//  meghív egy IDEGEN tokenjével, és megköveteli, hogy ne adjon tartalmat.
//  A fotó-rés ettől azonnal pirosra váltott volna.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob, createBooking,
} = require('./helpers');
const { PII_CSATORNA_MANIFEST } = require('./piiCsatornaManifest');

/**
 * Melyik útvonal-paramétert mivel helyettesítjük.
 * Minden `felek` GET-nek szerepelnie KELL itt — enélkül némán kimaradna.
 */
const PARAMETEREK = {
  'GET /jobs/:jobId/bids': (f) => `/jobs/${f.jobId}/bids`,
  'GET /jobs/:jobId/escrow': (f) => `/jobs/${f.jobId}/escrow`,
  'GET /jobs/:jobId/location/last': (f) => `/jobs/${f.jobId}/location/last`,
  'GET /messages': (f) => `/messages?job_id=${f.jobId}`,
  'GET /disputes/:id': (f) => `/disputes/${f.disputeId}`,
  'GET /disputes': () => '/disputes',
  'GET /route-bookings/:id': (f) => `/route-bookings/${f.bookingId}`,
  'GET /route-bookings/:bookingId/photos': (f) => `/route-bookings/${f.bookingId}/photos`,
  'GET /carrier-routes/:id/bookings': (f) => `/carrier-routes/${f.routeId}/bookings`,
  'GET /payments/payout-status/:jobId': (f) => `/payments/payout-status/${f.jobId}`,
};

/** Mezőnevek, amiknek IDEGEN számára tilos megjelenniük. */
const TILOS_MEZOK = [
  'recipient_name', 'recipient_phone', 'recipient_email', 'delivery_code',
  'sender_delivery_code', 'tracking_token', 'uploader_id', 'gps_lat', 'gps_lng',
  'resolution_note', 'evidence_url',
];

let f;
let idegen;

beforeAll(async () => {
  const felado = await createUser({ role: 'shipper' });
  const szallito = await createUser({ role: 'carrier' });
  idegen = await createUser({ role: 'carrier' });

  const job = await createJob({
    shipperId: felado.id, carrierId: szallito.id, status: 'in_progress', paid: true,
  });
  const { booking, routeId } = await createBooking({
    shipperId: felado.id, carrierId: szallito.id, status: 'confirmed', paid: true,
  });
  const { rows: vita } = await db.query(
    `INSERT INTO disputes (job_id, opened_by, description, status)
     VALUES ($1, $2, 'A doboz sérülten érkezett, Kovács János átvette', 'open')
     RETURNING id`,
    [job.id, felado.id],
  );

  // ⚠️ MINDEN VÉGPONTNAK ADATOT ADUNK (2026-08-12). Az első változat VAKON
  // ZÖLD volt: a fixture-ben nem volt fotó/ajánlat/üzenet, tehát minden
  // végpont üres tömböt adott — amit a teszt „nincs szivárgás"-ként fogadott
  // el. Lemértem: a fotó-rés visszatételével is átment. Ez UGYANAZ az osztály,
  // amit az export-őrnél találtunk („az üres tömb bizonyítéknak számít").
  await db.query(
    `INSERT INTO photos (job_id, uploader_id, kind, url, gps_lat, gps_lng)
     VALUES ($1, $2, 'listing', 'https://r2.example/hirdetes.jpg', 47.4979, 19.0402)`,
    [job.id, felado.id],
  );
  await db.query(
    `INSERT INTO photos (booking_id, uploader_id, kind, url)
     VALUES ($1, $2, 'pickup', 'https://r2.example/felvetel.jpg')`,
    [booking.id, szallito.id],
  );
  await db.query(
    `INSERT INTO bids (job_id, carrier_id, amount_huf, message, status)
     VALUES ($1, $2, 25000, 'Vállalom, hívj a 06 30 111 2222-n', 'pending')`,
    [job.id, szallito.id],
  );
  await db.query(
    `INSERT INTO messages (job_id, sender_id, recipient_id, body)
     VALUES ($1, $2, $3, 'Szia, a Kovács névre csöngess')`,
    [job.id, felado.id, szallito.id],
  );

  f = {
    jobId: job.id, bookingId: booking.id, routeId, disputeId: vita[0].id,
  };
});

describe('A „felek" besorolás mérve', () => {
  it('minden `felek` GET szerepel a paraméter-térképen', () => {
    const felekGetek = Object.entries(PII_CSATORNA_MANIFEST)
      .filter(([k, v]) => v === 'felek' && k.startsWith('GET '))
      .map(([k]) => k);
    expect(felekGetek.length, 'nem találtam felek-besorolású GET-et — az őr vak').toBeGreaterThan(5);

    const hianyzo = felekGetek.filter((k) => !PARAMETEREK[k]);
    expect(
      hianyzo,
      `Ezek a „felek" végpontok nincsenek a paraméter-térképen:\n  ${hianyzo.join('\n  ')}\n\n`
      + 'Enélkül némán kimaradnának a mérésből — és épp az a hiba, ami miatt ez\n'
      + 'a teszt létrejött: a „felek" címke egy ÁLLÍTÁS volt, amit senki nem mért.',
    ).toEqual([]);

    // …és fordítva: a térkép ne avuljon el
    const felesleges = Object.keys(PARAMETEREK).filter((k) => !felekGetek.includes(k));
    expect(felesleges, `Nem (már nem) „felek" besorolású: ${felesleges.join(', ')}`).toEqual([]);
  });

  it('IDEGEN egyetlen `felek` végponttól sem kap tartalmat', async () => {
    const gondok = [];

    for (const [kulcs, utvonal] of Object.entries(PARAMETEREK)) {
      const res = await request(app)
        .get(utvonal(f))
        .set('Authorization', `Bearer ${idegen.token}`);

      // Elfogadható: 403 / 404 / üres lista.
      if ([401, 403, 404].includes(res.status)) continue;
      if (res.status !== 200) {
        gondok.push(`${kulcs} → ${res.status} (váratlan státusz)`);
        continue;
      }
      const test = res.body;
      if (Array.isArray(test) && test.length === 0) continue;

      const szoveg = JSON.stringify(test);
      const talalt = TILOS_MEZOK.filter((m) => szoveg.includes(`"${m}"`));
      if (talalt.length > 0) {
        gondok.push(`${kulcs} → 200, és benne: ${talalt.join(', ')}`);
      } else if (Array.isArray(test) && test.length > 0) {
        gondok.push(`${kulcs} → 200, ${test.length} elem egy idegennek`);
      } else if (!Array.isArray(test) && Object.keys(test).length > 0) {
        gondok.push(`${kulcs} → 200, objektum ${Object.keys(test).length} mezővel`);
      }
    }

    expect(
      gondok,
      `Ezek a „felek" besorolású végpontok TARTALMAT adtak egy IDEGENNEK:\n  ${gondok.join('\n  ')}\n\n`
      + 'A „felek" besorolás azt jelenti, hogy a végpontnak SAJÁT jogosultság-\n'
      + 'ellenőrzése van, ezért nem kell rá külön kapu. Ha tartalmat ad egy\n'
      + 'kívülállónak, akkor ez az állítás HAMIS — és a PII-csatorna őr épp\n'
      + 'emiatt nem is nézte meg.\n\n'
      + 'Vagy tedd rá a jogosultság-ellenőrzést, vagy sorold át `masok`-ba\n'
      + '(akkor a kapu futásidőben ki lesz kényszerítve).',
    ).toEqual([]);
  });
});
