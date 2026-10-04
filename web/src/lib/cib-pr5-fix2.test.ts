// =====================================================================
//  CIB PR-5 (web) — 2. javítókör: a tiszta logika őrei (2026-10-04)
//
//  Az átnézés blokkoló pontja: az admin VISSZATÉRÍTÉSE (a bank terhelt, a
//  díjat visszautaltuk) a backendben „nem_terhelt" kimenetként jön, és a
//  felület erre azt írta: „Nem terheltük a kártyádat" — hamis pénzügyi
//  állítás, a kötelező banki adatsor RC=00-ja mellett. A nem blokkoló, olcsó
//  pontok: a „nyitott" sáv tiltás mellett is új fizetésre biztatott; a
//  másik (a bank oldalán is lehető) kísérlet miatti tiltás „pár másodperc"-et
//  ígért; a szünet szövege lezárást ígért ott is, ahol a kör nem fut; a
//  vegyes teszt-üzem sávja a többségnek a CIB-tesztkörnyezetet írta.
// =====================================================================
import { describe, expect, it } from 'vitest';
import * as fizetes from './cibFizetes';
import { fizetesTiltasUzenet, kartyaAllapot, nemTerheltMagyarazat } from './cibFizetes';
import * as feliratok from './cibFeliratok';
import { ervenyesKonfig, tesztUzemSav } from './publikusKonfig';

type Fv = (...a: any[]) => any;
const fv = (nev: string): Fv => {
  const f = (fizetes as unknown as Record<string, unknown>)[nev];
  expect(typeof f, `${nev} hiányzik a lib/cibFizetes.ts-ből`).toBe('function');
  return f as Fv;
};

const cib = (x: Record<string, unknown> = {}) => ({
  provider_kind: 'cib' as const, can_pay: true, open_attempt: null, last_result: null, ...x,
});
const oa = (allapot: string) => ({ trid: '1234567812345678', started_at: '2026-10-04T10:00:00Z', allapot });

describe('a visszatérített (terhelt, majd visszautalt) kísérlet felismerése — blokkoló', () => {
  it('kifejezett ok (admin_visszaterites / visszateritve) vagy saját állapot: visszatérítve', () => {
    const visszateritett = fv('visszateritett');
    expect(visszateritett({ allapot: 'nem_terhelt', ok: 'admin_visszaterites', rc: '00' })).toBe(true);
    expect(visszateritett({ allapot: 'nem_terhelt', ok: 'visszateritve', rc: null })).toBe(true);
    expect(visszateritett({ allapot: 'visszateritve', ok: null, rc: '00' })).toBe(true);
  });

  it('ok nélkül is: a „nem terhelt" kimenet RC=00-val (a bank lezárta) soha nem „nem terhelt"', () => {
    // A mai backend (cib-pr5/backend) az admin visszatérítését „nem_terhelt"
    // kimenettel és ok NÉLKÜL adja ki — de az adatsor RC-je 00: a bank a
    // tranzakciót lezárta, tehát terhelt.
    expect(fv('visszateritett')({ allapot: 'nem_terhelt', ok: null, rc: '00' })).toBe(true);
  });

  it('a valóban nem terhelt kimenetek nem minősülnek visszatérítésnek', () => {
    const visszateritett = fv('visszateritett');
    for (const a of [
      { allapot: 'nem_terhelt', ok: 'admin_nem_lezarva', rc: null },
      { allapot: 'nem_terhelt', ok: 'bank_visszaforditotta', rc: 'TO' },
      { allapot: 'nem_terhelt', ok: null, rc: null },
      { allapot: 'sikertelen', ok: null, rc: '05' },
      { allapot: 'sikeres', ok: null, rc: '00' },
      { allapot: 'ellenorzes', ok: null, rc: '00' },
      null,
    ]) {
      expect(visszateritett(a), JSON.stringify(a)).toBe(false);
    }
  });

  it('a visszatérítés magyarázata igaz: a bank terhelt, a díjat visszatérítettük — „nem terheltük" soha', () => {
    const s: string = fv('visszateritesMagyarazat')();
    expect(s).toMatch(/visszatérítettük/);
    expect(s).toMatch(/terhelte/);
    expect(s).not.toMatch(/nem terheltük|nem terhelt/i);
  });

  it('az AMO alatti mondat a visszatérítésnél sem állítja, hogy nem terheltünk', () => {
    const { amoMegjegyzes } = feliratok as unknown as { amoMegjegyzes: (k: string) => string | null };
    const s = amoMegjegyzes('visszateritve');
    expect(s).toMatch(/visszatérítettük/);
    expect(s).not.toMatch(/nem terheltük/);
    expect(s).not.toMatch(/fizetett összeg/);
  });

  it('a kártya állapota: a visszatérített kísérlet előző (nem sikeres) eredmény, nem siker és nem lezárás', () => {
    expect(kartyaAllapot(cib({ last_result: { trid: '1', rc: '00', allapot: 'visszateritve' } }) as any)).toBe('elozo_sikertelen');
    expect(kartyaAllapot(cib({ last_result: { trid: '1', rc: '00', allapot: 'nem_terhelt', ok: 'admin_visszaterites' } }) as any))
      .toBe('elozo_sikertelen');
  });
});

describe('az elhúzódó lezárás nem ígér másodperceket (nem blokkoló)', () => {
  // A backend a lezárás alatti (authorized/closing) és a — stub-úton vagy
  // hiányos konfignál — a bank oldalán hagyott kísérletet UGYANÍGY adja
  // („feldolgozas" + másik kísérlet). A javítás előtt a doboz mindkettőre
  // „pár másodperc"-et mondott, és vég nélkül kérdezett.
  it('kártyás úton az első percben a lezárás „pár másodperces"; utána elhúzódik', () => {
    const lezarasKesik = fv('lezarasKesik');
    const LEZARAS_KESES_MS = (fizetes as unknown as Record<string, number>).LEZARAS_KESES_MS;
    expect(LEZARAS_KESES_MS).toBeGreaterThan(0);
    expect(LEZARAS_KESES_MS).toBeLessThanOrEqual(90_000);
    expect(lezarasKesik(cib(), 0)).toBe(false);
    expect(lezarasKesik(cib(), LEZARAS_KESES_MS - 1)).toBe(false);
    expect(lezarasKesik(cib(), LEZARAS_KESES_MS)).toBe(true);
  });

  it('nem kártyás úton (stub / allowlist-váltás) rögtön elhúzódó: ott a bank oldalán hagyott kísérlet a jellemző', () => {
    const lezarasKesik = fv('lezarasKesik');
    expect(lezarasKesik({ ...cib(), provider_kind: 'stub' }, 0)).toBe(true);
    expect(lezarasKesik(null, 0)).toBe(true);
    // A kártya-állapot ettől nem változik: a gomb rejtve marad (lezárás).
    expect(kartyaAllapot({ ...cib(), provider_kind: 'stub', can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban', open_attempt: oa('feldolgozas') } as any))
      .toBe('lezaras');
  });

  it('az elhúzódó lezárás szövege nem ígér másodperceket, és kiutat ad', () => {
    const s: string = fv('folyamatbanSzoveg')('2026-10-04T10:00:00Z', Date.parse('2026-10-04T10:03:00Z'));
    expect(s).not.toMatch(/másodperc/);
    expect(s).toMatch(/ne indíts újat|Ne indíts újat/);
    expect(s).toMatch(/info@gofuvar\.hu/);
  });
});

describe('a „nyitott" sáv tiltás mellett nem biztat új fizetésre (nem blokkoló)', () => {
  it('ha új fizetés indítható: a bezárt banki oldal esetére új fizetést kínál', () => {
    expect(fv('nyitottSavSzoveg')('2026-10-04T10:00:00Z', true)).toMatch(/indíts újat/);
  });

  it('ha új fizetés most nem indítható (szünet, korlát, nem fizethető): nincs „indíts újat"', () => {
    const s: string = fv('nyitottSavSzoveg')('2026-10-04T10:00:00Z', false);
    expect(s).not.toMatch(/bezártad a bank oldalát, indíts újat/);
    expect(s).not.toMatch(/[^e] indíts újat/);
  });
});

describe('apró szöveg-igazítások (nem blokkoló)', () => {
  it('a szünet szövege nem ígér lezárást (hiányos konfignál a lekérdező kör sem fut), és nem állítja, hogy nincs terhelés', () => {
    const u = fizetesTiltasUzenet(cib({ can_pay: false, pay_blocked_reason: 'szunetel' }) as any)!;
    expect(u.szoveg).not.toMatch(/lezárjuk/);
    expect(u.szoveg).not.toMatch(/nem történt terhelés/i);
    expect(u.szoveg).toMatch(/nem indítható/);
  });

  it('a banki visszafordítás múlt időben mondja a feloldást (a backend értesítésével egyezően)', () => {
    expect(nemTerheltMagyarazat('bank_visszaforditotta')).toMatch(/feloldotta/);
  });

  it('vegyes teszt-üzem (CIB-teszt + stub): a sáv a szimulált díjfizetést is említi, és nem állít valódi terhelést', () => {
    const s = tesztUzemSav(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: 'teszt', szimulalt_fizetes: true }))!;
    expect(s.fajta).toBe('cib_teszt');
    expect(s.szoveg).toMatch(/szimulált/);
    expect(s.szoveg).toMatch(/CIB Bank tesztkörnyezet/);
    expect(s.szoveg).toMatch(/valódi terhelés nincs/);
  });
});
