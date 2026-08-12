// =====================================================================
//  FIZETÉSI LINK — CSAK A FIZETŐNEK (2026-08-12, 11. mérés A1)
//
//  ⚠️ EDDIG SEMMI NEM MÉRTE, MIT AD VISSZA EGY ÍRÁSI VÉGPONT.
//
//  Tizenegy adatvédelmi kör kizárólag GET-eket, socket-payloadokat és a sémát
//  vizsgálta. Azt, hogy egy POST/PATCH HTTP-VÁLASZ-TÖRZSE mit tartalmaz,
//  egyetlen őr sem nézte — és pontosan ott volt a rés:
//
//    POST /jobs/:id/instant-accept        → a SZÁLLÍTÓ hívja
//    POST /route-bookings/:id/confirm     → a SZÁLLÍTÓ hívja
//
//  mindkettő visszaadta a `gateway_url`-t, ami a FELADÓ fizetési munkamenete
//  a PSP-nél. A socket-ág (emitToUser a feladóhoz) 2026-08-09 óta helyes, és
//  az `accept-counter` ágon a HTTP-válaszból is szándékosan kimaradt — vagyis
//  a szabály ISMERT volt, csak két helyen nem alkalmaztuk. Ugyanabban a
//  handlerben, 45 sorral a saját indokló komment alatt.
//
//  Stubbal ma ártalmatlan (`stub:cib/<id>`); a CIB élesítésével valódi banki
//  fizetőoldal URL-je kerülne a másik félhez. Ez pontosan az a
//  „provider-váltásnál élesedő" osztály, ami már kétszer megvágott minket.
// =====================================================================
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';

const require = createRequire(import.meta.url);
const {
  app, db, createUser, createJob,
} = require('./helpers');

/** A fizetési munkamenetre utaló kulcsok — ezek csak a fizetőhöz mehetnek. */
const FIZETESI_KULCSOK = ['gateway_url', 'gatewayUrl', 'barion_gateway_url'];

function fizetesiLinket(valasz) {
  const szoveg = JSON.stringify(valasz || {});
  return FIZETESI_KULCSOK.filter((k) => szoveg.includes(`"${k}"`));
}

describe('Fizetési link: kizárólag a fizetőhöz', () => {
  it('az AZONNALI fuvar elvállalása nem adja vissza a linket a szállítónak', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });
    await db.query(
      `UPDATE jobs SET is_instant = TRUE, status = 'bidding',
                       instant_expires_at = NOW() + INTERVAL '1 hour',
                       suggested_price_huf = 25000
        WHERE id = $1`,
      [job.id],
    );

    const res = await request(app)
      .post(`/jobs/${job.id}/instant-accept`)
      .set('Authorization', `Bearer ${szallito.token}`).send({});

    // A végpont sikerétől függetlenül: a linknek NEM szabad benne lennie.
    const talalt = fizetesiLinket(res.body);
    expect(
      talalt,
      `Az azonnali fuvar elvállalásának válasza a SZÁLLÍTÓNAK adta a fizetési `
      + `munkamenetet: ${talalt.join(', ')}\n\n`
      + 'Ezt a végpontot a szállító hívja, a fizető viszont a feladó. A feladó\n'
      + 'a linket a saját értesítésében (emitToUser) és a /pay válaszában kapja.',
    ).toEqual([]);
  });

  it('a FOGLALÁS megerősítése sem adja vissza a linket a szállítónak', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const { booking } = await require('./helpers').createBooking({
      shipperId: felado.id, carrierId: szallito.id, status: 'pending',
    });

    const res = await request(app)
      .post(`/route-bookings/${booking.id}/confirm`)
      .set('Authorization', `Bearer ${szallito.token}`).send({});

    const talalt = fizetesiLinket(res.body);
    expect(
      talalt,
      `A foglalás-megerősítés válasza a SZÁLLÍTÓNAK adta a fizetési `
      + `munkamenetet: ${talalt.join(', ')}`,
    ).toEqual([]);
  });

  it('a FIZETŐ viszont megkapja (a védelem nem túl széles)', async () => {
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted',
    });
    await db.query(
      'UPDATE jobs SET accepted_price_huf = 25000 WHERE id = $1', [job.id],
    );

    const res = await request(app)
      .post(`/jobs/${job.id}/pay`)
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ consent: true });

    expect(res.status, `a fizetés-indítás elbukott: ${JSON.stringify(res.body)}`).toBe(200);
    expect(
      fizetesiLinket(res.body).length,
      'A FELADÓ (a fizető) nem kapta meg a fizetési linket — a védelem túl széles, '
      + 'így nem tudna fizetni.',
    ).toBeGreaterThan(0);
  });
});
