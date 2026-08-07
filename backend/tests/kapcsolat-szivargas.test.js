// =====================================================================
//  KAPCSOLAT-SZIVÁRGÁS VÉDELEM (anti-bypass)
//
//  Miért ez a legfontosabb üzleti őr: a platform EGYETLEN bevétele a
//  kapcsolatfelvételi díj, és azt a felek pontosan úgy kerülnék meg, hogy a
//  chatben elküldik egymásnak a telefonszámukat, majd a platformon kívül
//  intézik a fuvart. A `detectContactLeak` ezt akadályozza meg.
//
//  MIÉRT KELLETT MEGÍRNI (2026-08-07): a mutációs tesztelés kimutatta, hogy
//  ez a modul 10%-os mutáció-pontszámon állt — sőt, a függvény TELJES
//  KIÜRÍTÉSE (`{}`) is túlélte a teljes teszt-készletet. Vagyis a bevételt
//  védő szűrőt egyetlen teszt sem hívta meg olyan szöveggel, amit blokkolnia
//  kellett volna. Ha valaki elrontja vagy törli, semmi nem szólt volna.
//
//  A tesztek VALÓS megkerülési trükköket használnak, nem elméleti mintákat.
// =====================================================================
import { describe, it, expect } from 'vitest';

const { detectContactLeak } = require('../src/utils/contactGuard');

/** Blokkolást vár, és azt is, hogy a felhasználó megtudja, mi a teendő. */
function blokkol(szoveg, mibol = 'telefonszám') {
  const ok = detectContactLeak(szoveg);
  expect(ok, `NEM blokkolta (${mibol}): "${szoveg}"`).toBeTruthy();
  expect(ok, 'a hibaüzenet nem magyarázza el a megoldást')
    .toMatch(/kapcsolatfelvételi díj|chat-funkciót/i);
  return ok;
}

/** Átengedést vár — a jóhiszemű üzenet nem akadhat fenn. */
function atenged(szoveg) {
  expect(
    detectContactLeak(szoveg),
    `TÉVESEN blokkolta egy ártalmatlan üzenetet: "${szoveg}"`,
  ).toBeNull();
}

describe('Telefonszám-szivárgás: a bevált megkerülési formák', () => {
  it('a szokásos magyar írásmódok mind fennakadnak', () => {
    for (const szam of [
      '06301234567',
      '06 30 123 4567',
      '06-30-123-4567',
      '06/30/123-4567',
      '+36301234567',
      '+36 30 123 4567',
      '+36-30-123 45 67',
      '0036301234567',
      '0036 30 123 4567',
      '(06) 30 123 4567',
      '06.30.123.4567',
    ]) {
      blokkol(`Hívj fel: ${szam}`);
    }
  });

  it('a szeparátoros trükközés sem segít (aláhúzás, pont, zárójel)', () => {
    blokkol('a szamom 06_30_123_4567 hivj');
    blokkol('06(30)123(4567)');
    blokkol('0 6 3 0 1 2 3 4 5 6 7');
  });

  it('külföldi szám is fennakad, ha elég hosszú számjegy-sorozat', () => {
    blokkol('call me 4917612345678');
    blokkol('a számom 431234567890');
  });

  it('a puszta 9+ jegyű sorozat is blokkol (prefix nélkül)', () => {
    blokkol('301234567');
    blokkol('123456789');
  });
});

describe('E-mail-szivárgás', () => {
  it('a szokásos e-mail formák fennakadnak', () => {
    for (const cim of [
      'valaki@example.com',
      'kiss.anna@gmail.com',
      'teszt+cimke@ceg.co.uk',
      'a_b-c%d@alma.hu',
    ]) {
      const ok = blokkol(`Írj ide: ${cim}`, 'e-mail');
      expect(ok, 'e-mailre a telefonos üzenet jött').toMatch(/mail/i);
    }
  });
});

describe('Amit SZÁNDÉKOSAN átenged — különben használhatatlan lenne a chat', () => {
  it('méret, súly, ár és mennyiség nem gyanús', () => {
    atenged('A doboz 120 cm hosszú, 80 cm széles.');
    atenged('A csomag 25 kg, kb. 200000 Ft értékű.');
    atenged('Kb. 3 db doboz lesz, összesen 45 kg.');
  });

  it('irányítószám és házszám nem gyanús', () => {
    atenged('6800 Hódmezővásárhely, Fő utca 12.');
    atenged('1134 Budapest, Váci út 45/B');
  });

  it('időpont és dátum nem gyanús', () => {
    atenged('Holnap 14:30-kor érek oda.');
    atenged('2026. 08. 15-én tudom hozni.');
  });

  it('a normál beszélgetés átmegy', () => {
    atenged('Szia! Mikor tudod hozni a csomagot?');
    atenged('Rendben, akkor holnap délelőtt. Köszi!');
  });
});

describe('Robusztusság: nem-szöveg és üres bemenet', () => {
  it('üres és hiányzó értékre nem dob, nem is blokkol', () => {
    for (const ertek of [null, undefined, '', 0, false]) {
      expect(detectContactLeak(ertek), `elszállt vagy blokkolt: ${String(ertek)}`).toBeNull();
    }
  });

  it('nem-string típusra sem dob (szám, objektum, tömb)', () => {
    for (const ertek of [12345678901, { a: 1 }, [1, 2, 3], true]) {
      expect(() => detectContactLeak(ertek)).not.toThrow();
      expect(
        detectContactLeak(ertek),
        'nem-string értéket blokkolt — a hívó oldalon ez néma hibát okozna',
      ).toBeNull();
    }
  });
});

describe('A védelem élesben is működik: chat és kérdés-válasz', () => {
  const request = require('supertest');
  const { app, createUser, createJob, db } = require('./helpers');
  const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

  it('a chatben elküldött telefonszámot a szerver visszautasítja', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });

    const res = await request(app).post('/messages')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, body: 'Hívj: 06 30 123 4567, intézzük platformon kívül' });

    expect(
      res.status,
      'A platform-megkerülő üzenet ÁTMENT a chaten!',
    ).toBeGreaterThanOrEqual(400);

    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM messages WHERE job_id = $1', [job.id],
    );
    expect(rows[0].n, 'A blokkolt üzenet mégis eltárolódott').toBe(0);
  });

  it('a fuvarra feltett kérdésben sem lehet elérhetőséget megadni', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({ shipperId: felado.id, status: 'bidding' });

    const res = await request(app).post(`/jobs/${job.id}/questions`)
      .set('Authorization', `Bearer ${szallito.token}`)
      .send({ question: 'Írj rám: valaki@example.com és megbeszéljük' });

    expect(res.status, 'Az e-mail cím átment a nyilvános kérdésben!').toBeGreaterThanOrEqual(400);
  });

  it('a díj KIFIZETÉSE UTÁN már szabad a telefonszám — akkor már jár nekik', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: true,
    });

    const res = await request(app).post('/messages')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, body: 'A számom 06 30 123 4567, hívj ha itt vagy!' });

    expect(
      res.status,
      'Fizetés UTÁN is blokkolta a telefonszámot — pedig a díj épp ezt vette meg.',
    ).toBeLessThan(400);
  });

  it('a jóhiszemű üzenet viszont átmegy — nem bénítjuk le a kommunikációt', async () => {
    __resetRateLimitsForTests();
    const felado = await createUser({ role: 'shipper' });
    const szallito = await createUser({ role: 'carrier' });
    const job = await createJob({
      shipperId: felado.id, carrierId: szallito.id, status: 'accepted', paid: false,
    });

    const res = await request(app).post('/messages')
      .set('Authorization', `Bearer ${felado.token}`)
      .send({ job_id: job.id, body: 'Szia! A doboz 120 cm, kb. 25 kg. Holnap 14:30 jó?' });

    expect(res.status, JSON.stringify(res.body)).toBeLessThan(400);
  });
});
