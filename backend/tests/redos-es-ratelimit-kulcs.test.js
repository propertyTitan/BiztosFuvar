// =====================================================================
//  KÉT EGYÜTT HATÓ TÁMADÁSI FELÜLET ZÁRÁSA (2026-08-09, audit)
//
//  1) ReDoS a kapcsolat-szűrő e-mail-mintájában. A régi minta domain-része
//     tartalmazta a pontot, amit egy `\.` követett — átfedő kvantorok,
//     négyzetes visszalépés. MÉRVE: 100 KB bemenet 16,5 MÁSODPERCRE
//     megállította a Node egyszálú event-loopját, vagyis a backend egyetlen
//     kérést sem szolgált ki. A `POST /auth/register` hitelesítés NÉLKÜL
//     hívható, és a `company_name` mezőnek nem volt hosszkorlátja → egy
//     kéréses, bejelentkezés nélküli teljes leállás.
//
//  2) A rate limiter a NYERS `X-Forwarded-For` fejléc első eleméből képezte
//     a kulcsot — azt viszont a kliens írja. Kérésenként más értékkel a
//     limit teljesen megkerülhető volt, ami az 1) pontot korlátlanul
//     ismételhetővé tette (és a jelszó-brute-force-ot is kinyitotta).
//
//  A kettő együtt volt a legveszélyesebb: egy védtelen végpont + egy
//  végtelenszer ismételhető, egy kéréses leállító.
// =====================================================================
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

const { app, uniqueEmail } = require('./helpers');
const { detectContactLeak, MAX_SCAN_LENGTH } = require('../src/utils/contactGuard');
const { __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

beforeEach(() => { __resetRateLimitsForTests(); });

describe('Kapcsolat-szűrő: ReDoS-ellenállás', () => {
  it('100 KB-os „bomba" bemenet ezredmásodpercek alatt lefut', () => {
    const bomba = `${'a'.repeat(50000)}@${'a'.repeat(50000)}`; // sosem illeszkedik: nincs pont
    const t0 = Date.now();
    detectContactLeak(bomba);
    const eltelt = Date.now() - t0;
    // A javítás előtt ez ~16 500 ms volt. A 2000 ms-os plafon nagyságrendekkel
    // a régi érték alatt van, de bőven elbírja a lassabb CI-futót is.
    expect(eltelt, `ReDoS: a szűrő ${eltelt} ms-ig blokkolta az event-loopot`).toBeLessThan(2000);
  });

  it('a növekvő bemeneten a futásidő nem robban (nem négyzetes)', () => {
    const meres = (n) => {
      const s = `${'a'.repeat(n)}@${'a'.repeat(n)}`;
      const t0 = Date.now();
      detectContactLeak(s);
      return Date.now() - t0;
    };
    meres(1000); // bemelegítés (JIT)
    const kicsi = meres(10000);
    const nagy = meres(50000);
    // Négyzetes visszalépésnél az 5× méret ~25× időt adna. A hossz-plafon
    // miatt itt gyakorlatilag konstans a futásidő.
    expect(nagy).toBeLessThan(Math.max(kicsi * 5 + 50, 500));
  });

  it('a szűrő csak az első MAX_SCAN_LENGTH karaktert vizsgálja', () => {
    expect(MAX_SCAN_LENGTH).toBeLessThanOrEqual(5000);
    const rejtett = `${'x'.repeat(MAX_SCAN_LENGTH + 100)}teszt@pelda.hu`;
    // Tudatos kompromisszum: a plafonon TÚLI tartalmat nem nézzük — cserébe a
    // szűrő nem használható fegyverként a szerver ellen. A hívók (requireText)
    // amúgy is jóval rövidebb szövegeket engednek.
    expect(detectContactLeak(rejtett)).toBeNull();
  });

  it('a felismerés VÁLTOZATLANUL működik a valós eseteken', () => {
    expect(detectContactLeak('irj: teszt.elek@gmail.com')).toBeTruthy();
    expect(detectContactLeak('a@b.co.uk')).toBeTruthy();
    expect(detectContactLeak('hivj 06 30 123 4567')).toBeTruthy();
    expect(detectContactLeak('+36 30 123 4567')).toBeTruthy();
    // …és a legitim szöveget nem blokkolja
    expect(detectContactLeak('Budapest, Váci út 1., 30 kg, 200x40x30 cm, 15000 Ft')).toBeNull();
    expect(detectContactLeak('ráérek @ délután')).toBeNull();
  });

  it('a hitelesítés nélküli regisztráció sem lassítható meg óriás mezővel', async () => {
    const t0 = Date.now();
    const res = await request(app).post('/auth/register').send({
      email: uniqueEmail('redos'),
      password: 'JelszoTeszt123',
      full_name: 'Teszt Elek',
      company_name: `${'a'.repeat(60000)}@${'a'.repeat(60000)}`,
    });
    const eltelt = Date.now() - t0;
    expect(eltelt, `a register ${eltelt} ms-ig futott egy óriás mezővel`).toBeLessThan(3000);
    // A válasz bármi lehet (400 validáció vagy 201) — a lényeg, hogy GYORS.
    expect(res.status).toBeLessThan(500);
  });
});

describe('Rate limit: a kulcs nem hamisítható a kliens fejlécével', () => {
  // A valós felállás: a Railway edge a VALÓDI kliens IP-t fűzi az
  // X-Forwarded-For lista VÉGÉRE, az Express pedig (trust proxy = 1) a
  // jobb szélső elemet veszi. A támadó által beírt bal oldali érték tehát
  // nem befolyásolhatja a kulcsot. A régi kód a BAL szélsőt olvasta.
  const login = (hamisPrefix) => request(app)
    .post('/auth/login')
    .set('X-Forwarded-For', `${hamisPrefix}, 10.0.0.7`) // jobb szélső = „valódi" kliens
    .send({ email: 'nincs-ilyen@pelda.hu', password: 'RosszJelszo123' });

  it('kérésenként változtatott hamis IP mellett is FÉKEZ a limiter', async () => {
    let blokkolt = 0;
    for (let i = 0; i < 25; i++) {
      const res = await login(`9.9.9.${i}`); // minden kérésnél MÁS hamis érték
      if (res.status === 429) blokkolt += 1;
    }
    expect(
      blokkolt,
      'A RATE LIMIT MEGKERÜLHETŐ: hamisított X-Forwarded-For-ral korlátlan próbálkozás!',
    ).toBeGreaterThan(0);
  });

  it('a limit ugyanígy fékez fix fejléc mellett (kontroll)', async () => {
    let blokkolt = 0;
    for (let i = 0; i < 25; i++) {
      const res = await login('9.9.9.9');
      if (res.status === 429) blokkolt += 1;
    }
    expect(blokkolt).toBeGreaterThan(0);
  });
});
