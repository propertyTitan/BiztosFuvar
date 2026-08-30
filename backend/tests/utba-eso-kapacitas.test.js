// =====================================================================
//  ÚTBA ESŐ FUVAROK — KAPACITÁS-SZŰRÉS (GF-009, Manus 2026-08-30)
//
//  A Manus-repró: egy 75,5 kg-os fuvar ajánlódott fel egy olyan járathoz,
//  amelynek legnagyobb meghirdetett kategóriája L (max 25 kg). A szállító
//  fizikailag nem tudta volna elvinni — az ajánlás zaj, ami a funkcióba
//  vetett bizalmat rontja.
//
//  A szabály: az ISMERT adat kizárhat (nyilvánvaló túlsúly/túlméret a járat
//  legnagyobb meghirdetett kategóriájához mérve), a HIÁNYZÓ adat nem — a
//  fuvarok szabad szövegesek, nem minden feladó ad meg mindent, arról a
//  szállító dönt.
// =====================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

const { app, db, createUser } = require('./helpers');
const { jobFitsCapacity } = require('../src/services/routeAlong');

/** Bidding fuvar a Budapest→Szeged úton, megadható súllyal/méretekkel. */
async function biddingJob(shipperId, { weight = null, dims = null, title }) {
  const { rows } = await db.query(
    `INSERT INTO jobs (
       shipper_id, title, description,
       pickup_address, pickup_lat, pickup_lng,
       dropoff_address, dropoff_lat, dropoff_lng,
       weight_kg, length_cm, width_cm, height_cm,
       suggested_price_huf, status, delivery_code, tracking_token
     ) VALUES (
       $1, $2, 'kapacitás-teszt',
       'Budapest, Teszt u. 1.', 47.4979, 19.0402,
       'Szeged, Teszt tér 2.', 46.253, 20.1414,
       $3, $4, $5, $6,
       15000, 'bidding', '111222', encode(gen_random_bytes(16), 'hex')
     ) RETURNING id`,
    [shipperId, title, weight, dims?.[0] ?? null, dims?.[1] ?? null, dims?.[2] ?? null],
  );
  return rows[0].id;
}

describe('GET /carrier-routes/:id/along-jobs — a járat plafonja felett nincs ajánlás', () => {
  let carrier;
  let routeId;
  let tulsulyosId;
  let beleferoId;
  let ismeretlenSulyuId;
  let tulmeretesId;

  beforeAll(async () => {
    carrier = await createUser({ role: 'carrier' });
    const shipper = await createUser();

    // Járat Budapest→Szeged, legfeljebb L (max 25 kg) kategóriával.
    const res = await request(app)
      .post('/carrier-routes')
      .set('Authorization', `Bearer ${carrier.token}`)
      .send({
        title: 'Kapacitás-teszt járat',
        departure_at: new Date(Date.now() + 86400000).toISOString(),
        waypoints: [
          { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
          { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
        ],
        prices: [
          { size: 'S', price_huf: 3000 },
          { size: 'L', price_huf: 12000 },
        ],
      });
    expect(res.status).toBe(201);
    routeId = res.body.id;

    tulsulyosId = await biddingJob(shipper.id, { weight: 75.5, title: 'Túlsúlyos (Manus-repró)' });
    beleferoId = await biddingJob(shipper.id, { weight: 20, dims: [70, 50, 40], title: 'Belefér L-be' });
    ismeretlenSulyuId = await biddingJob(shipper.id, { title: 'Ismeretlen súly' });
    tulmeretesId = await biddingJob(shipper.id, { weight: 10, dims: [300, 40, 30], title: 'Túl hosszú' });
  });

  it('a 75,5 kg-os fuvar NEM ajánlódik a 25 kg-plafonos járathoz', async () => {
    const res = await request(app)
      .get(`/carrier-routes/${routeId}/along-jobs`)
      .set('Authorization', `Bearer ${carrier.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.jobs.map((j) => j.id);

    expect(
      ids.includes(tulsulyosId),
      'A 75,5 kg-os fuvar felajánlódott egy L-plafonos (max 25 kg) járathoz — '
      + 'pontosan a Manus GF-009 reprója: a szállító el sem tudná vinni.',
    ).toBe(false);
    expect(
      ids.includes(tulmeretesId),
      'A 300 cm-es csomag felajánlódott, pedig az L leghosszabb oldala 80 cm.',
    ).toBe(false);
    expect(ids.includes(beleferoId), 'a plafon ALATTI fuvarnak ajánlódnia kell').toBe(true);
    expect(
      ids.includes(ismeretlenSulyuId),
      'A súly/méret nélküli fuvart NEM szabad kiszűrni — hiányzó adat nem '
      + 'kizáró ok, arról a szállító dönt.',
    ).toBe(true);
  });
});

describe('jobFitsCapacity — a szabály élei', () => {
  it('plafon nélkül (nincs árazott méret) minden átmegy', () => {
    expect(jobFitsCapacity({ weight_kg: 999 }, null)).toBe(true);
  });

  it('a pg NUMERIC string-alakját is érti (weight_kg: "75.5")', () => {
    // A pg a numeric oszlopot STRINGKÉNT adja vissza — ha a szűrő ezt nem
    // kezelné, élesben soha nem szűrne, miközben a teszt-literálokkal zöld.
    expect(jobFitsCapacity({ weight_kg: '75.5' }, 'L')).toBe(false);
    expect(jobFitsCapacity({ weight_kg: '20' }, 'L')).toBe(true);
  });

  it('a méretek oldal-sorrendje nem számít (forgatva is belefér)', () => {
    // L: 80 × 60 × 50 — a 50 × 80 × 60 ugyanaz a doboz elforgatva.
    expect(jobFitsCapacity({ weight_kg: 10, length_cm: 50, width_cm: 80, height_cm: 60 }, 'L')).toBe(true);
  });

  it('XL-plafonnál az XL-be férő nehéz csomag átmegy, az azon túli nem', () => {
    expect(jobFitsCapacity({ weight_kg: 50 }, 'XL')).toBe(true);
    expect(jobFitsCapacity({ weight_kg: 50.5 }, 'XL')).toBe(false);
  });
});
