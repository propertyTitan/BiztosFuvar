// =====================================================================
//  CÍM-PONTOSSÁG + FELADÓI VÉSZKÓD A DÍJ MÖGÖTT (GF-008/010, 2026-08-30)
//
//  KÉT USER-DÖNTÉS ugyanazon a napon:
//
//  GF-008: „a fizetésig csak az utca látszódjon, a házszám ne" — a nyitott
//  piactéren böngésző (nem fél) ÉS a kijelölt, de még nem fizetett
//  szállító utca-szintű címet kap; a házszám + a ház-pontos koordináta a
//  díj megfizetése után jár. ⚠️ A koordinátát is kerekíteni KELL (~110 m):
//  a pontos lat/lng-ből a házszám visszafejthető — a két védelem csak
//  együtt ér valamit (ugyanaz a lecke, mint a telepulesSzint + ~1 km-es
//  kerekítés párosánál).
//
//  GF-010: a feladó SAJÁT vészhelyzeti kódja (sender_delivery_code) is
//  csak a díj kifizetése után — előtte a felvétel úgysem indulhat
//  (paid_at guard), a kód idő előtti kiadása semmit nem nyer.
// =====================================================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, db, createUser, createJob } = require('./helpers');
const { utcaSzint } = require('../src/utils/address');

const HAZSZAMOS_PICKUP = 'Budapest, Váci út 12, 1132';
const HAZSZAMOS_DROPOFF = 'Szeged, Kárász utca 9, 6720';

describe('GF-010: a feladói vészkód csak a díj után', () => {
  it('elfogadott, de FIZETETLEN fuvaron a feladó NEM kapja meg a saját kódját', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: false });

    const res = await request(app)
      .get(`/jobs/${job.id}`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(res.status).toBe(200);
    expect(
      res.body.sender_delivery_code,
      'A feladó a díj kifizetése ELŐTT megkapta a vészhelyzeti kódját — a '
      + 'user-döntés (GF-010) szerint a kód csak paid_at után jár.',
    ).toBeUndefined();
  });

  it('a díj kifizetése UTÁN a feladó megkapja a kódját (a lezáráshoz kell)', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: shipper.id, carrierId: carrier.id, paid: true });

    const res = await request(app)
      .get(`/jobs/${job.id}`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(res.status).toBe(200);
    expect(
      res.body.sender_delivery_code,
      'Fizetés után a feladónak KELL a saját kódja — enélkül a „nincs külön '
      + 'címzett" alapesetben nem tudná lezáratni a fuvart.',
    ).toBeTruthy();
    // A CÍMZETT kódja fizetés után SEM jár a feladónak (2026-08-06 döntés).
    expect(res.body.delivery_code).toBeUndefined();
  });
});

describe('GF-008: fizetésig utca-szintű cím + kerekített koordináta', () => {
  it('a nyitott piactéren böngésző szállító NEM látja a házszámot és a pontos koordinátát', async () => {
    const shipper = await createUser();
    const bongeszo = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: null, status: 'bidding', paid: false,
      pickupAddress: HAZSZAMOS_PICKUP, dropoffAddress: HAZSZAMOS_DROPOFF,
    });

    const res = await request(app)
      .get(`/jobs/${job.id}`)
      .set('Authorization', `Bearer ${bongeszo.token}`);
    expect(res.status).toBe(200);

    expect(res.body.pickup_address).toContain('Váci út');
    expect(
      res.body.pickup_address.includes('12'),
      `A böngésző szállító látja a házszámot: "${res.body.pickup_address}" — `
      + 'a user-döntés (GF-008): a fizetésig csak az utca.',
    ).toBe(false);
    expect(res.body.dropoff_address).toContain('Kárász utca');
    expect(res.body.dropoff_address.includes('9')).toBe(false);

    // A koordináta ~110 m-re kerekítve — a pontos koordinátából a házszám
    // visszafejthető lenne, hiába rejtjük a cím szövegében.
    expect(Number(res.body.pickup_lat)).toBe(47.498);
    expect(
      Number(res.body.pickup_lat) === 47.4979,
      'A pontos koordináta kiment a böngészőnek — abból a házszám visszafejthető.',
    ).toBe(false);
  });

  it('a kijelölt, de még NEM fizetett szállító is csak utca-szintet lát', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, paid: false,
      pickupAddress: HAZSZAMOS_PICKUP, dropoffAddress: HAZSZAMOS_DROPOFF,
    });

    const res = await request(app)
      .get(`/jobs/${job.id}`)
      .set('Authorization', `Bearer ${carrier.token}`);
    expect(res.status).toBe(200);
    expect(res.body.pickup_address).toContain('Váci út');
    expect(
      res.body.pickup_address.includes('12'),
      'A kijelölt szállító a díj kifizetése ELŐTT látja a házszámot — a díj '
      + 'megkerülhető lenne: elfogadás után fizetés nélkül is odaállhatna.',
    ).toBe(false);
    expect(Number(res.body.pickup_lat)).toBe(47.498);
  });

  it('a díj kifizetése UTÁN a szállító a pontos címet és koordinátát kapja', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, paid: true,
      pickupAddress: HAZSZAMOS_PICKUP, dropoffAddress: HAZSZAMOS_DROPOFF,
    });

    const res = await request(app)
      .get(`/jobs/${job.id}`)
      .set('Authorization', `Bearer ${carrier.token}`);
    expect(res.status).toBe(200);
    expect(res.body.pickup_address).toBe(HAZSZAMOS_PICKUP);
    expect(Number(res.body.pickup_lat)).toBe(47.4979);
  });

  it('a FELADÓ mindig a saját pontos címét látja', async () => {
    const shipper = await createUser();
    const job = await createJob({
      shipperId: shipper.id, carrierId: null, status: 'bidding', paid: false,
      pickupAddress: HAZSZAMOS_PICKUP, dropoffAddress: HAZSZAMOS_DROPOFF,
    });

    const res = await request(app)
      .get(`/jobs/${job.id}`)
      .set('Authorization', `Bearer ${shipper.token}`);
    expect(res.status).toBe(200);
    expect(res.body.pickup_address).toBe(HAZSZAMOS_PICKUP);
    expect(Number(res.body.pickup_lat)).toBe(47.4979);
  });

  it('a foglalási ágon a szállító fizetés előtt szintén utca-szintet lát', async () => {
    const { createBooking } = require('./helpers');
    const carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();
    // A fixture címe: „Budapest, Teszt u. 1." — utca-szinten nincs benne szám.
    const { booking } = await createBooking({
      carrierId: carrier.id,
      shipperId: shipper.id,
      paid: false,
    });

    const res = await request(app)
      .get(`/route-bookings/${booking.id}`)
      .set('Authorization', `Bearer ${carrier.token}`);
    expect(res.status).toBe(200);
    expect(res.body.pickup_address).toContain('Teszt u');
    expect(
      /\d/.test(res.body.pickup_address),
      `A foglalási ágon a szállító fizetés előtt látja a házszámot: `
      + `"${res.body.pickup_address}" — a fuvar-ággal azonos szabálynak kell élnie (GF-008).`,
    ).toBe(false);
    expect(Number(res.body.pickup_lat)).toBe(47.498);
  });
});

describe('utcaSzint — tartalom-alapú házszám-eltávolítás', () => {
  it('magyar formátum: a házszám lekerül, az utca + irányítószám marad', () => {
    expect(utcaSzint('Budapest, Váci út 12, 1132')).toBe('Budapest, Váci út, 1132');
    expect(utcaSzint('Szeged, Kárász utca 9., 6720')).toBe('Szeged, Kárász utca, 6720');
  });

  it('német/román formátum (utca elöl): a házszám lekerül, a város marad', () => {
    expect(utcaSzint('Hauptstraße 5, 10115 Berlin, Germany')).toBe('Hauptstraße, 10115 Berlin, Germany');
    expect(utcaSzint('Strada Mihai Viteazu 12, Arad')).toBe('Strada Mihai Viteazu, Arad');
  });

  it('tartományos és betűs házszámok is lekerülnek (60-62, 12/B)', () => {
    expect(utcaSzint('Budapest, Andrássy út 60-62, 1062')).toBe('Budapest, Andrássy út, 1062');
    expect(utcaSzint('Budapest, Váci út 12/B, 1132')).toBe('Budapest, Váci út, 1132');
  });

  it('házszám nélküli címet nem bánt', () => {
    expect(utcaSzint('Budapest, Hungary')).toBe('Budapest, Hungary');
  });

  it('FAIL-CLOSED: azonosíthatatlan szám-maradéknál a szakasz kimarad', () => {
    // A „HRSZ 0123/4" nem szabványos házszám — a minta nem ismeri fel,
    // ezért az egész szakasznak ki kell esnie, nem átcsúsznia.
    const eredmeny = utcaSzint('Külterület HRSZ 0123/4 dűlő, Szatymaz');
    expect(eredmeny.includes('0123')).toBe(false);
    expect(eredmeny).toContain('Szatymaz');
  });
});

describe('GF-008 regresszió: a szabály MINDEN listán él (Manus 2. futás)', () => {
  it('/bids/mine: saját ajánlat után sincs házszám a nyitott fuvar címében', async () => {
    // A Manus-regresszió találata: a RÉSZLETEZŐ már maszkolt, de ez a lista
    // saját ajánlat után házszámos címet adott — a védelem csak azon az
    // úton épült meg, ahol felfedezték.
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: null, status: 'bidding', paid: false,
      pickupAddress: HAZSZAMOS_PICKUP, dropoffAddress: HAZSZAMOS_DROPOFF,
    });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, return_policy) VALUES ($1, $2, 12000, 'included')`,
      [job.id, carrier.id],
    );

    const res = await request(app)
      .get('/bids/mine')
      .set('Authorization', `Bearer ${carrier.token}`);
    expect(res.status).toBe(200);
    const sor = res.body.find((b) => b.job_id === job.id);
    expect(sor).toBeTruthy();
    expect(sor.pickup_address).toContain('Váci út');
    expect(
      sor.pickup_address.includes('12'),
      `Az Ajánlataim lista házszámos címet ad fizetés előtt: "${sor.pickup_address}"`,
    ).toBe(false);
    expect(sor.job_paid_at, 'a paid_at belső adat — nem való a listába').toBeUndefined();
  });

  it('/bids/mine: kijelölt + FIZETETT szállítónak viszont pontos cím jár', async () => {
    const shipper = await createUser();
    const carrier = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: shipper.id, carrierId: carrier.id, status: 'accepted', paid: true,
      pickupAddress: HAZSZAMOS_PICKUP, dropoffAddress: HAZSZAMOS_DROPOFF,
    });
    await db.query(
      `INSERT INTO bids (job_id, carrier_id, amount_huf, status, return_policy) VALUES ($1, $2, 12000, 'accepted', 'included')`,
      [job.id, carrier.id],
    );

    const res = await request(app)
      .get('/bids/mine')
      .set('Authorization', `Bearer ${carrier.token}`);
    const sor = res.body.find((b) => b.job_id === job.id);
    expect(sor.pickup_address).toBe(HAZSZAMOS_PICKUP);
  });
});
