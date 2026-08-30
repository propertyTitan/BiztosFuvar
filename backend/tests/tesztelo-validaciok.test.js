// 2026-08-04-i tesztelői kör észrevételei — backend-oldali kényszerítés.
//
// Mindhárom szabálynak a SZERVEREN is állnia kell: a böngésző `min`
// attribútuma, a beviteli szűrés és a JS-validáció felhasználói kényelem,
// de egy curl-lel megkerülhető.
//
//  1) Múltbeli indulási időpontra nem lehet járatot hirdetni.
//  2) Ha más veszi át a csomagot, a címzett NEVE és TELEFONSZÁMA is kötelező.
//  3) A csomagméret egész cm, a forint-mezők kerek forintok, negatív nincs.
import { describe, it, expect } from 'vitest';
import request from 'supertest';

const { app, createUser } = require('./helpers');

const WAYPOINTS = [
  { name: 'Budapest', lat: 47.4979, lng: 19.0402, order: 0 },
  { name: 'Szeged', lat: 46.253, lng: 20.1414, order: 1 },
];

function routeBody(departureAt) {
  return {
    title: 'Budapest → Szeged',
    departure_at: departureAt,
    waypoints: WAYPOINTS,
    prices: [{ size: 'M', price_huf: 10000 }],
  };
}

/** Érvényes fuvar-alaptest, amire a teszt mezőket ír felül. */
function jobBody(overrides = {}) {
  return {
    title: 'Teszt fuvar',
    pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.4979, pickup_lng: 19.0402,
    dropoff_address: 'Szeged, Kossuth Lajos sgt. 1.', dropoff_lat: 46.253, dropoff_lng: 20.1414,
    weight_kg: 5, length_cm: 40, width_cm: 30, height_cm: 20,
    suggested_price_huf: 15000,
    ...overrides,
  };
}

describe('Járat indulása: a múlt tiltva', () => {
  it('múltbeli departure_at → 400, DEPARTURE_IN_PAST', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const res = await request(app)
      .post('/carrier-routes')
      .set('Authorization', `Bearer ${carrier.token}`)
      .send(routeBody(new Date(Date.now() - 24 * 3600 * 1000).toISOString()));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEPARTURE_IN_PAST');
    expect(res.body.error).toMatch(/nem lehet a múltban/i);
  });

  it('érvénytelen dátum-string → 400 (nem 500)', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const res = await request(app)
      .post('/carrier-routes')
      .set('Authorization', `Bearer ${carrier.token}`)
      .send(routeBody('tegnap délután'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/érvénytelen/i);
  });

  it('jövőbeli departure_at → létrejön', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const res = await request(app)
      .post('/carrier-routes')
      .set('Authorization', `Bearer ${carrier.token}`)
      .send(routeBody(new Date(Date.now() + 24 * 3600 * 1000).toISOString()));

    expect(res.status).toBe(201);
  });

  it('meglévő járatot sem lehet PATCH-csel a múltba állítani', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const created = await request(app)
      .post('/carrier-routes')
      .set('Authorization', `Bearer ${carrier.token}`)
      .send(routeBody(new Date(Date.now() + 24 * 3600 * 1000).toISOString()));
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`/carrier-routes/${created.body.id}`)
      .set('Authorization', `Bearer ${carrier.token}`)
      .send({ departure_at: new Date(Date.now() - 3600 * 1000).toISOString() });

    expect(patched.status).toBe(400);
    expect(patched.body.code).toBe('DEPARTURE_IN_PAST');
  });

  it('a járat egyéb mezői időpont-módosítás nélkül szerkeszthetők maradnak', async () => {
    const carrier = await createUser({ role: 'carrier' });
    const created = await request(app)
      .post('/carrier-routes')
      .set('Authorization', `Bearer ${carrier.token}`)
      .send(routeBody(new Date(Date.now() + 24 * 3600 * 1000).toISOString()));

    const patched = await request(app)
      .patch(`/carrier-routes/${created.body.id}`)
      .set('Authorization', `Bearer ${carrier.token}`)
      .send({ vehicle_description: 'Kisteherautó' });

    expect(patched.status).toBe(200);
  });
});

describe('Címzett: ha más veszi át, név + telefon kötelező', () => {
  it('csak név, telefon nélkül → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ recipient_name: 'Kiss Anna' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECIPIENT_INCOMPLETE');
  });

  it('csak telefon, név nélkül → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ recipient_phone: '+36 30 123 4567' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECIPIENT_INCOMPLETE');
  });

  it('csak email (a másik kettő nélkül) sem elég — a szállító nem tudná felhívni', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ recipient_email: 'anna@example.com' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECIPIENT_INCOMPLETE');
  });

  it('a csupa-szóköz név nem számít kitöltöttnek', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ recipient_name: '   ', recipient_phone: '+36 30 123 4567' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECIPIENT_INCOMPLETE');
  });

  it('szemét telefonszám → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ recipient_name: 'Kiss Anna', recipient_phone: 'hívj fel' }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECIPIENT_PHONE_INVALID');
  });

  it('név + telefon együtt → létrejön, trimmelve mentve', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ recipient_name: '  Kiss Anna  ', recipient_phone: ' +36 30 123 4567 ' }));

    expect(res.status).toBe(201);
    expect(res.body.recipient_name).toBe('Kiss Anna');
    expect(res.body.recipient_phone).toBe('+36 30 123 4567');
  });

  it('címzett nélkül (a feladó veszi át) továbbra is feladható', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody());

    expect(res.status).toBe(201);
    expect(res.body.recipient_name).toBeNull();
  });
});

describe('Fuvar-feladás: negatív és tört értékek', () => {
  it('negatív méret → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ length_cm: -40 }));

    expect(res.status).toBe(400);
  });

  it('tört centiméter → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ length_cm: 40.5 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/egész centiméter/i);
  });

  it('filléres fuvardíj → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ suggested_price_huf: 15000.5 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kerek forint/i);
  });

  it('negatív fuvardíj → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ suggested_price_huf: -1000 }));

    expect(res.status).toBe(400);
  });

  it('filléres csomagérték → 400', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ declared_value_huf: 50000.25 }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kerek forint/i);
  });

  it('a TÖRT SÚLY viszont megengedett (12,5 kg valós eset)', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({ weight_kg: 12.5 }));

    expect(res.status).toBe(201);
  });
});

// GF-005 (Manus, 2026-08-30): az opcionális címzett-e-mail eddig BÁRMIT
// elfogadott („hibas-email"), pedig követési linket ígérünk rá — a levél
// némán a semmibe ment volna. A szabálynak a szerveren is állnia kell.
describe('Címzett-e-mail szintaxis (GF-005)', () => {
  it('hibás e-mail (a Manus-repró) → 400 RECIPIENT_EMAIL_INVALID', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({
        recipient_name: 'Kiss Anna',
        recipient_phone: '+36 30 123 4567',
        recipient_email: 'hibas-email',
      }));

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RECIPIENT_EMAIL_INVALID');
  });

  it('érvényes e-mail → létrejön, trimmelve mentve', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({
        recipient_name: 'Kiss Anna',
        recipient_phone: '+36 30 123 4567',
        recipient_email: '  anna@email.hu  ',
      }));

    expect(res.status).toBe(201);
    expect(res.body.recipient_email).toBe('anna@email.hu');
  });

  it('üres/kihagyott e-mail továbbra is rendben (opcionális mező)', async () => {
    const user = await createUser();
    const res = await request(app)
      .post('/jobs')
      .set('Authorization', `Bearer ${user.token}`)
      .send(jobBody({
        recipient_name: 'Kiss Anna',
        recipient_phone: '+36 30 123 4567',
        recipient_email: '   ',
      }));

    expect(res.status).toBe(201);
    expect(res.body.recipient_email).toBeNull();
  });
});
