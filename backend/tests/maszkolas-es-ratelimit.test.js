// =====================================================================
//  MASZKOLÁS ÉS RATE LIMIT — két csendes garancia
//
//  A mutációs mérés (2026-08-07) ezt a két modult találta a leggyengébben
//  őrzöttnek: mask.js 3%, rateLimit.js 23%. Egyikük sem látványos funkció,
//  de mindkettő valódi garanciát véd:
//
//    mask.js      – a szerverlogba SOHA ne kerüljön teljes e-mail vagy
//                   telefonszám. A Railway-logokat több ember látja, és a
//                   naplókra ugyanúgy vonatkozik az adattakarékosság, mint
//                   az adatbázisra.
//    rateLimit.js – ez a brute-force és a spam elleni első védvonal: a
//                   belépési kísérletek, a regisztráció és az írási
//                   műveletek korlátja.
//
//  ⚠️ A tesztek SZÁNDÉKOSAN a viselkedés HATÁRAIT feszegetik (pont a limiten,
//  eggyel fölötte, ablak-forduló), mert a mutációs mérés épp azt mutatta,
//  hogy a határok körül vakok voltunk: a `>` → `>=` típusú elrontásokat
//  egyetlen teszt sem kapta el.
// =====================================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const { maskEmail, maskPhone } = require('../src/utils/mask');
const { createRateLimit, __resetRateLimitsForTests } = require('../src/middleware/rateLimit');

// =====================================================================
//  MASZKOLÁS
// =====================================================================
describe('maskEmail: a naplóba csak az első betű és a domain kerülhet', () => {
  it('a helyi részt egyetlen betűre rövidíti, a domaint meghagyja', () => {
    expect(maskEmail('jovanygyula@gmail.com')).toBe('j***@gmail.com');
    expect(maskEmail('a@b.hu')).toBe('a***@b.hu');
    expect(maskEmail('KISS.ANNA@ceg.co.uk')).toBe('K***@ceg.co.uk');
  });

  it('a teljes helyi rész SOHA nem jelenik meg a kimenetben', () => {
    const eredmeny = maskEmail('sajatnevem@pelda.hu');
    expect(eredmeny).not.toContain('sajatnevem');
    expect(eredmeny.startsWith('s***@'), `váratlan alak: ${eredmeny}`).toBe(true);
  });

  it('a domain viszont MEGMARAD — enélkül a napló használhatatlan lenne', () => {
    // Hibakereséskor az kell látszódjon, melyik szolgáltatóhoz ment a levél
    expect(maskEmail('valaki@resend.dev')).toContain('@resend.dev');
  });

  it('érvénytelen és hiányzó bemenetre teljesen elrejt', () => {
    for (const rossz of [null, undefined, '', '   ', 'nincs-kukac', 42, {}, []]) {
      const eredmeny = maskEmail(rossz);
      expect(
        eredmeny === '***' || !String(eredmeny).includes('@') === false,
        `gyanús kimenet erre: ${JSON.stringify(rossz)} → ${eredmeny}`,
      ).toBeTruthy();
    }
    expect(maskEmail(null)).toBe('***');
    expect(maskEmail('nincs-kukac')).toBe('***');
    expect(maskEmail(12345)).toBe('***');
  });

  it('kukaccal kezdődő címnél sem dob (üres helyi rész)', () => {
    expect(() => maskEmail('@domain.hu')).not.toThrow();
    expect(maskEmail('@domain.hu')).toBe('***@domain.hu');
  });
});

describe('maskPhone: csak az utolsó négy számjegy maradhat', () => {
  it('a szám végét mutatja, az elejét elrejti', () => {
    expect(maskPhone('+36301234567')).toBe('***4567');
    expect(maskPhone('06 30 123 4567')).toBe('***4567');
    expect(maskPhone('06-30-999-8888')).toBe('***8888');
  });

  it('a szám ELEJE soha nem jelenik meg — abból lehet körzetre következtetni', () => {
    const eredmeny = maskPhone('+36301234567');
    expect(eredmeny).not.toContain('3630');
    expect(eredmeny).not.toContain('123');
  });

  it('a nem-számjegyeket eldobja a hossz-számításnál', () => {
    // "+36 (30) 12-34" → 8 számjegy → az utolsó 4 látszik
    expect(maskPhone('+36 (30) 12-34')).toBe('***1234');
  });

  it('négynél kevesebb számjegynél MINDENT elrejt', () => {
    // Pont a határ: 4 jegy még mutatható, 3 már nem
    expect(maskPhone('1234')).toBe('***1234');
    expect(maskPhone('123')).toBe('***');
    expect(maskPhone('12')).toBe('***');
    expect(maskPhone('ab-cd')).toBe('***');   // nulla számjegy
  });

  it('hiányzó és nem-string bemenetre is elrejt, nem dob', () => {
    for (const rossz of [null, undefined, '', 0, false]) {
      expect(maskPhone(rossz)).toBe('***');
    }
    expect(() => maskPhone({ a: 1 })).not.toThrow();
    expect(maskPhone(36301234567)).toBe('***4567');  // számként átadva is működjön
  });
});

// =====================================================================
//  RATE LIMIT
// =====================================================================
describe('rateLimit: a korlát pontosan ott van, ahol mondjuk', () => {
  /** Minimális kérés/válasz páros a middleware közvetlen hívásához. */
  function futtat(limiter, { ip = '1.2.3.4', userId = null } = {}) {
    const fejlecek = {};
    let statusz = 200;
    let test = null;
    const req = {
      headers: { 'x-forwarded-for': ip },
      socket: { remoteAddress: ip },
      user: userId ? { sub: userId } : undefined,
    };
    const res = {
      setHeader: (k, v) => { fejlecek[k] = v; },
      status(k) { statusz = k; return this; },
      json(t) { test = t; return this; },
    };
    let tovabbengedve = false;
    limiter(req, res, () => { tovabbengedve = true; });
    return { tovabbengedve, statusz, test, fejlecek };
  }

  beforeEach(() => { __resetRateLimitsForTests(); });

  it('a limitig ENGED, a limit FÖLÖTT tilt — a határ nem csúszhat el', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 3, name: 'hatarteszt' });

    // Pontosan a limitig: mind átmegy
    for (let i = 1; i <= 3; i += 1) {
      const r = futtat(limiter);
      expect(r.tovabbengedve, `a ${i}. kérés (limit=3) elakadt`).toBe(true);
    }
    // A limit FÖLÖTT: elakad
    const negyedik = futtat(limiter);
    expect(negyedik.tovabbengedve, 'a 4. kérés átment, pedig max=3').toBe(false);
    expect(negyedik.statusz).toBe(429);
    expect(negyedik.test.error).toBeTruthy();
    expect(negyedik.test.retry_after_seconds).toBeGreaterThan(0);
  });

  it('a maradék-számláló pontosan fogy, és nem megy negatívba', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 2, name: 'maradek' });

    expect(futtat(limiter).fejlecek['X-RateLimit-Remaining']).toBe('1');
    expect(futtat(limiter).fejlecek['X-RateLimit-Remaining']).toBe('0');
    // Túllépve sem lehet negatív — a kliens azt nem tudná értelmezni
    expect(futtat(limiter).fejlecek['X-RateLimit-Remaining']).toBe('0');
    expect(futtat(limiter).fejlecek['X-RateLimit-Limit']).toBe('2');
  });

  it('az időablak leteltével újraindul a számlálás', () => {
    vi.useFakeTimers();
    try {
      const limiter = createRateLimit({ windowMs: 60_000, max: 1, name: 'ablak' });
      expect(futtat(limiter).tovabbengedve).toBe(true);
      expect(futtat(limiter).tovabbengedve, 'a 2. kérés átment az ablakon belül').toBe(false);

      // Az ablak MÉG tart (59 mp) — továbbra is tilt
      vi.advanceTimersByTime(59_000);
      expect(futtat(limiter).tovabbengedve, 'az ablakon BELÜL feloldott').toBe(false);

      // Az ablak letelt — újra szabad
      vi.advanceTimersByTime(2_000);
      expect(futtat(limiter).tovabbengedve, 'az ablak letelte után sem engedett').toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('rateLimit: kit korlátozunk — IP-t, usert vagy mindkettőt', () => {
  beforeEach(() => { __resetRateLimitsForTests(); });

  function futtat(limiter, ip, userId) {
    const req = {
      headers: { 'x-forwarded-for': ip },
      socket: { remoteAddress: ip },
      user: userId ? { sub: userId } : undefined,
    };
    let tovabb = false;
    limiter(req, { setHeader() {}, status() { return this; }, json() { return this; } },
      () => { tovabb = true; });
    return tovabb;
  }

  it('IP-alapú korlát: MÁS IP-ről még szabad, ugyanarról már nem', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1, keyBy: 'ip', name: 'ipk' });
    expect(futtat(limiter, '1.1.1.1')).toBe(true);
    expect(futtat(limiter, '1.1.1.1'), 'ugyanaz az IP átment másodszor is').toBe(false);
    expect(futtat(limiter, '2.2.2.2'), 'MÁS IP-t is korlátozott — az DoS-t okozna').toBe(true);
  });

  it('user-alapú korlát: a felhasználót követi, IP-váltás nem segít', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1, keyBy: 'user', name: 'userk' });
    expect(futtat(limiter, '1.1.1.1', 'user-A')).toBe(true);
    expect(
      futtat(limiter, '9.9.9.9', 'user-A'),
      'IP-váltással megkerülhető volt a user-limit',
    ).toBe(false);
    expect(futtat(limiter, '1.1.1.1', 'user-B'), 'másik usert is korlátozott').toBe(true);
  });

  it('ip+user korlát: a kettő KOMBINÁCIÓJA a kulcs', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1, keyBy: 'ip+user', name: 'ipuk' });
    expect(futtat(limiter, '1.1.1.1', 'user-A')).toBe(true);
    expect(futtat(limiter, '1.1.1.1', 'user-A')).toBe(false);
    // Ugyanaz a user MÁS IP-ről: külön vödör
    expect(futtat(limiter, '2.2.2.2', 'user-A')).toBe(true);
    // Ugyanaz az IP MÁS userrel: szintén külön
    expect(futtat(limiter, '1.1.1.1', 'user-B')).toBe(true);
  });

  it('a proxy-fejléc ELSŐ IP-jét használjuk (a lánc többi tagja hamisítható)', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1, keyBy: 'ip', name: 'proxy' });
    expect(futtat(limiter, '5.5.5.5, 10.0.0.1, 10.0.0.2')).toBe(true);
    // Ugyanaz a valódi kliens, más proxy-lánccal → UGYANAZ a vödör
    expect(
      futtat(limiter, '5.5.5.5, 172.16.0.9'),
      'a lánc megváltoztatásával megkerülhető volt a korlát',
    ).toBe(false);
  });

  it('bejelentkezetlen hívók közös „anon" vödörbe kerülnek user-alapú limitnél', () => {
    const limiter = createRateLimit({ windowMs: 60_000, max: 1, keyBy: 'user', name: 'anonk' });
    expect(futtat(limiter, '1.1.1.1', null)).toBe(true);
    expect(futtat(limiter, '2.2.2.2', null), 'az anon hívók nem egy vödörben vannak').toBe(false);
  });
});

// A mutációs mérés megmutatta, hogy az ELŐRE BEÁLLÍTOTT limiterek
// konfigurációját (kulcsolás, max, ablak) semmi nem őrizte: ha valaki a
// `writeRateLimit`-et user-alapúról IP-alapúra állítja, attól egyetlen teszt
// sem lesz piros — pedig az érdemi viselkedés-változás: egy irodából/mobil-
// hálózatról érkező felhasználók egy vödörbe kerülnének, és kizárnák egymást.
describe('rateLimit: az ÉLES limiterek kulcsolása és korlátja', () => {
  const {
    loginRateLimit, registerRateLimit, writeRateLimit,
    aiChatRateLimit, globalRateLimit,
  } = require('../src/middleware/rateLimit');

  beforeEach(() => { __resetRateLimitsForTests(); });

  /** Hányadik kérésnél tilt a limiter? (max + 1 a várt érték.) */
  function tiltasnal(limiter, { ip = '1.2.3.4', userId = 'u1', korlat = 400 } = {}) {
    for (let i = 1; i <= korlat; i += 1) {
      const req = {
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
        user: userId ? { sub: userId } : undefined,
      };
      let tovabb = false;
      limiter(req, { setHeader() {}, status() { return this; }, json() { return this; } },
        () => { tovabb = true; });
      if (!tovabb) return i;
    }
    return null;
  }

  it('belépés: IP-alapú, 10/perc', () => {
    expect(tiltasnal(loginRateLimit, { ip: '10.0.0.1' })).toBe(11);
    // MÁS IP-ről még szabad → tényleg IP-alapú, nem globális
    __resetRateLimitsForTests();
    expect(tiltasnal(loginRateLimit, { ip: '10.0.0.1' })).toBe(11);
  });

  it('regisztráció: IP-alapú, 5/óra', () => {
    expect(tiltasnal(registerRateLimit, { ip: '10.0.0.2' })).toBe(6);
  });

  it('írás: USER-alapú, 30/perc — és két user NEM zárja ki egymást egy IP-ről', () => {
    expect(tiltasnal(writeRateLimit, { ip: '10.0.0.3', userId: 'user-A' })).toBe(31);
    // UGYANARRÓL az IP-ről egy MÁSIK user még dolgozhat. Ha ez elbukik, a
    // limiter IP-alapúvá csúszott, és egy irodából csak egyvalaki dolgozhatna.
    expect(
      tiltasnal(writeRateLimit, { ip: '10.0.0.3', userId: 'user-B' }),
      'ugyanarról az IP-ről a MÁSIK user is ki lett zárva',
    ).toBe(31);
  });

  it('AI-segéd: user-alapú, 20/perc', () => {
    expect(tiltasnal(aiChatRateLimit, { ip: '10.0.0.4', userId: 'user-C' })).toBe(21);
  });

  it('globális: IP-alapú, 300/perc — a per-végpont limitek MÖGÖTT', () => {
    const n = tiltasnal(globalRateLimit, { ip: '10.0.0.5', korlat: 400 });
    expect(n).toBe(301);
    // A globális limit lazább kell legyen a belépésinél, különben az utóbbi
    // sosem lépne életbe
    expect(n).toBeGreaterThan(11);
  });
});

describe('rateLimit: az éles limitek a beállított értéken állnak', () => {
  beforeEach(() => { __resetRateLimitsForTests(); });

  it('a belépési limit tényleg korlátoz (brute-force elleni első védvonal)', async () => {
    const request = require('supertest');
    const { app } = require('./helpers');

    // A /auth/login IP-alapon 10/perc. A 11. már 429.
    //
    // ⚠️ Transport-hibára EGYSZER újrapróbálunk: 12 gyors kérés a supertesten
    // keresztül időnként „socket hang up"-pal elszáll (a mutációs futás
    // környezetében elő is jött). Ez a teszt-harness zaja, nem az
    // alkalmazásé — de a hibát nem nyeljük el: kétszeri elszállásnál dobunk.
    async function loginProba() {
      for (let probalkozas = 1; probalkozas <= 2; probalkozas += 1) {
        try {
          return await request(app).post('/auth/login')
            .send({ email: 'nincs-ilyen@teszt.hu', password: 'rossz' });
        } catch (err) {
          if (probalkozas === 2) throw err;
          await new Promise((r) => { setTimeout(r, 80); });
        }
      }
      return undefined;
    }

    let utolso;
    for (let i = 0; i < 12; i += 1) {
      utolso = await loginProba();
      if (utolso.status === 429) break;
    }
    expect(
      utolso.status,
      'A belépés korlátlanul próbálgatható — jelszó-brute-force nyitva.',
    ).toBe(429);
    expect(utolso.body.retry_after_seconds).toBeGreaterThan(0);
  });
});
