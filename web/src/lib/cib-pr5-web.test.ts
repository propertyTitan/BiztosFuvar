// =====================================================================
//  CIB PR-5 (web) — a díjfizetés tiszta logikájának őrei (2026-10-03)
//
//  A web↔backend szerződés (C1–C6) webes fele és az audit megerősített
//  leletei (9, 10, 11, 24, 25, 26, 27, 29, 30): minden pont egy olyan eset,
//  amikor a felület mást mondott, mint ami a pénzzel történt, vagy kiút
//  nélkül hagyta a vásárlót.
// =====================================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  kartyaAllapot, fizetesHibaUzenet, fizetesTiltasUzenet, nemTerheltMagyarazat,
  varakozasHibaUtan, nyilatkozatHiany, LASSU_LEKERDEZES_MS,
} from './cibFizetes';
import * as feliratModul from './cibFeliratok';
import { CIB_FELIRATOK, CIB_IDO_TIPP } from './cibFeliratok';
import { ervenyesKonfig, tesztUzemSav } from './publikusKonfig';
import { ugyfelUzenet } from './cibRcCsoport';

const cib = (x: Record<string, unknown> = {}) => ({
  provider_kind: 'cib' as const, can_pay: true, open_attempt: null, last_result: null, ...x,
});
const oa = (allapot: string) => ({ trid: '1234567812345678', started_at: '2026-10-03T10:00:00Z', allapot });

describe('a kártya állapota (C3, leletek 24 és 25)', () => {
  it('24: a függő CIB-kísérlet akkor is látszik, ha a fiók közben stub-útra került', () => {
    // A javítás előtt a provider_kind='stub' minden kísérletet elrejtett: a
    // close_unknown alatt stub-gomb és sárga sáv jelent meg „Ne fizess újra" helyett.
    const stub = { ...cib(), provider_kind: 'stub' as const, can_pay: false };
    expect(kartyaAllapot({ ...stub, open_attempt: oa('ellenorzes') } as any)).toBe('ellenorzes');
    expect(kartyaAllapot({ ...stub, open_attempt: oa('feldolgozas') } as any)).toBe('lezaras');
    // Kísérlet nélkül a stub továbbra is a mai felület.
    expect(kartyaAllapot({ ...cib(), provider_kind: 'stub' } as any)).toBe('alap');
  });

  it('25a: az ellenőrzés mindig elsőbbséget kap (egy újabb, futó kísérlet sem takarja el)', () => {
    const fp = cib({ can_pay: false, open_attempt: oa('feldolgozas'), last_result: { trid: '9', allapot: 'ellenorzes' } });
    expect(kartyaAllapot(fp as any)).toBe('ellenorzes');
  });

  it('a tiltás oka szerint: a lezárás-doboz csak „másik kísérlet" (vagy ok nélküli tiltás) esetén jön', () => {
    expect(kartyaAllapot(cib({ can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban', open_attempt: oa('feldolgozas') }) as any))
      .toBe('lezaras');
    for (const ok of ['probalkozasi_limit', 'szunetel', 'nem_fizetheto']) {
      expect(kartyaAllapot(cib({ can_pay: false, pay_blocked_reason: ok, open_attempt: oa('feldolgozas') }) as any), ok)
        .toBe('nyitott');
    }
  });

  it('25: can_pay=false mellett a tiltás MEGNEVEZETT okot kap; can_pay=true mellett nincs tiltás', () => {
    expect(fizetesTiltasUzenet(cib() as any)).toBeNull();
    expect(fizetesTiltasUzenet(null)).toBeNull();
    const szovegek = new Set<string>();
    for (const ok of ['masik_kiserlet_folyamatban', 'probalkozasi_limit', 'szunetel', 'nem_fizetheto', null, 'ismeretlen_uj_ok']) {
      const u = fizetesTiltasUzenet(cib({ can_pay: false, pay_blocked_reason: ok }) as any);
      expect(u, String(ok)).not.toBeNull();
      expect(u!.szoveg).toMatch(/[a-z]/);
      szovegek.add(u!.szoveg);
    }
    // A négy szerződéses ok mind saját szöveget kap (az ismeretlen és a
    // hiányzó ok osztozhat az általánoson).
    expect(szovegek.size).toBeGreaterThanOrEqual(5);
    expect(fizetesTiltasUzenet(cib({ can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban' }) as any)!.szoveg)
      .toMatch(/Ne indíts újat/);
    // A próbálkozási korlát nem ígérhet egy órát (a napi korlát akár egy napra zár).
    expect(fizetesTiltasUzenet(cib({ can_pay: false, pay_blocked_reason: 'probalkozasi_limit' }) as any)!.szoveg)
      .not.toMatch(/egy órá/);
  });
});

describe('nem terhelt kimenet okai (C5, lelet 9)', () => {
  it('az admin-egyeztetés és a banki visszafordítás saját, igaz szöveget kap — „a fuvar megváltozott" soha', () => {
    const admin = nemTerheltMagyarazat('admin_nem_lezarva');
    const bank = nemTerheltMagyarazat('bank_visszaforditotta');
    expect(admin).toMatch(/bankkal egyeztettük/);
    expect(bank).toMatch(/bank/);
    for (const s of [admin, bank, nemTerheltMagyarazat(null), nemTerheltMagyarazat('ismeretlen')]) {
      expect(s).toMatch(/nem terheltük/i);
      expect(s).not.toMatch(/megváltozott/);
    }
    expect(admin).not.toBe(bank);
  });
});

describe('fizetési hibakódok (C2, lelet 30)', () => {
  // A backend CIB-útjának MINDEN kódja (a forrásból olvasva, nem kézzel
  // másolva): ha a backend új kódot vezet be, és a web nem kap hozzá saját
  // szöveget, ez az őr piros.
  function backendKodok(): string[] {
    const gyoker = path.join(process.cwd(), '..', 'backend', 'src');
    const cibForras = fs.readFileSync(path.join(gyoker, 'services', 'cibFizetes.js'), 'utf8');
    const hibak = cibForras.match(/const HIBAK = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
    expect(hibak, 'a backend HIBAK táblája nem található').not.toBeNull();
    const kodok = [...hibak![1].matchAll(/^\s*([A-Z_]+):\s*\[/gm)].map((x) => x[1]);
    const munkamenet = fs.readFileSync(path.join(gyoker, 'services', 'feePaymentSession.js'), 'utf8');
    kodok.push(...[...munkamenet.matchAll(/code: '([A-Z_]+)'/g)].map((x) => x[1]));
    return [...new Set(kodok)];
  }

  it('minden backend-kód (és a CIB_PAUSED) saját szöveget kap, nem az általánost', () => {
    const kodok = [...backendKodok(), 'CIB_PAUSED', 'CONSENT_REQUIRED'];
    expect(kodok.length).toBeGreaterThanOrEqual(12);
    const altalanos = fizetesHibaUzenet({ code: 'NINCS_ILYEN_KOD' }).szoveg;
    for (const code of kodok) {
      expect(fizetesHibaUzenet({ code }).szoveg, code).not.toBe(altalanos);
    }
  });

  it('CIB_PAUSED (503): a kártyás fizetés szünetel, terhelés nincs, a futó fizetések lezárulnak', () => {
    const u = fizetesHibaUzenet({ code: 'CIB_PAUSED', status: 503, message: 'SZERVER-SZÖVEG' });
    expect(u.szoveg).toMatch(/szünetel/);
    expect(u.szoveg).toMatch(/nem történt terhelés/);
    expect(u.szoveg).not.toMatch(/SZERVER-SZÖVEG/);
    expect(u.teendo).toBe('allapot');
  });

  it('PAYMENT_RETRY_LIMIT: nem ígér „legfeljebb egy órát" (a napi korlát egy napra is zárhat)', () => {
    expect(fizetesHibaUzenet({ code: 'PAYMENT_RETRY_LIMIT', status: 429 }).szoveg).not.toMatch(/egy órá/);
  });

  it('kód nélküli 409 / 403 / 429: nem a „próbáld újra pár perc múlva" általános szöveg', () => {
    const altalanos = fizetesHibaUzenet({}).szoveg;
    expect(fizetesHibaUzenet({ status: 409 }).szoveg).not.toBe(altalanos);
    expect(fizetesHibaUzenet({ status: 409 }).teendo).toBe('fuvar');
    expect(fizetesHibaUzenet({ status: 403 }).szoveg).not.toBe(altalanos);
    expect(fizetesHibaUzenet({ status: 429 }).szoveg).not.toBe(altalanos);
  });
});

describe('429 → lassítás (lelet 11)', () => {
  it('a szerver retry_after értékét tiszteletben tartja, plafonnal; 429 nélkül az alapütem marad', () => {
    expect(varakozasHibaUtan({ status: 503 }, 3_000)).toBe(3_000);
    expect(varakozasHibaUtan({ status: 429, retryAfterMs: 45_000 }, 3_000)).toBe(45_000);
    expect(varakozasHibaUtan({ status: 429 }, 3_000)).toBe(LASSU_LEKERDEZES_MS);
    expect(varakozasHibaUtan({ status: 429, retryAfterMs: 3_600_000 }, 3_000)).toBeLessThanOrEqual(120_000);
    // Rövidebbet nem kérhet, mint az alapütem.
    expect(varakozasHibaUtan({ status: 429, retryAfterMs: 1_000 }, 20_000)).toBe(20_000);
  });
});

describe('a tiltott gomb magyarázata (lelet 29)', () => {
  it('megnevezi, melyik nyilatkozat hiányzik', () => {
    expect(nyilatkozatHiany({ consent: true, cibHozzajarulas: true, cibUt: true })).toBeNull();
    expect(nyilatkozatHiany({ consent: true, cibHozzajarulas: false, cibUt: false })).toBeNull();
    expect(nyilatkozatHiany({ consent: false, cibHozzajarulas: false, cibUt: false })).toMatch(/azonnali teljesítés/);
    expect(nyilatkozatHiany({ consent: true, cibHozzajarulas: false, cibUt: true })).toMatch(/CIB Bank felé történő adattovábbítás/);
    const mindketto = nyilatkozatHiany({ consent: false, cibHozzajarulas: false, cibUt: true })!;
    expect(mindketto).toMatch(/mindkét/);
  });
});

describe('feliratok (leletek 27 és a nem fizetett AMO)', () => {
  it('az idő-tipp a helyi zárási határidőhöz (MSGT10 + 9:30, a visszatérés után azonnali lekérdezés) igazodik: kb. 8 perc', () => {
    expect(CIB_IDO_TIPP).toMatch(/8 perc/);
    expect(CIB_IDO_TIPP).not.toMatch(/9 perc|10 perc/);
  });

  // 2026-10-03 (a PR-5 web 1. javítóköre): az előző kör a nem sikeres
  // kimenetnél „A tranzakció összege (AMO)"-ra írta át a banki feliratot — a
  // CIB szerint a kísérőszövegnek a banki listával KELL egyeznie, és a
  // sikertelen-fizetés levele is a banki feliratot írja. Az AMO-nak tehát
  // egyetlen felirata van; a kimenetet külön mondat (amoMegjegyzes) mondja.
  it('az AMO-nak egyetlen, banki felirata van — „(AMO)"-ra végződő másik felirat nem exportálható', () => {
    const amoFeliratok = Object.values(feliratModul)
      .filter((v): v is string => typeof v === 'string' && /\(AMO\)$/.test(v));
    expect(amoFeliratok).toEqual([]);
    expect(CIB_FELIRATOK.amo).toBe('A fizetett összeg (AMO)');
    expect(Object.keys(feliratModul)).not.toContain('amoFelirat');
  });

  it('a kimenet mondata: sikernél nincs; nem terhelt kísérletnél „nem terheltük"; egyeztetésnél semmit nem állít', () => {
    const { amoMegjegyzes } = feliratModul as unknown as { amoMegjegyzes?: (k: string) => string | null };
    expect(typeof amoMegjegyzes).toBe('function');
    expect(amoMegjegyzes!('sikeres')).toBeNull();
    expect(amoMegjegyzes!('nem_terhelt')).toMatch(/nem terheltük/);
    expect(amoMegjegyzes!('ellenorzes')).toMatch(/egyeztet/);
    expect(amoMegjegyzes!('ellenorzes')).not.toMatch(/nem terheltük|terheltük a kártyádat/);
    for (const k of ['nem_terhelt', 'ellenorzes']) expect(amoMegjegyzes!(k)).not.toMatch(/fizetett összeg/);
  });
});

describe('publikus konfiguráció és a teszt-üzem sávja (C1)', () => {
  it('fail-closed: hiányzó / hibás válasz → nincs sáv (és nincs „nincs valódi pénz" állítás)', () => {
    for (const rossz of [null, undefined, {}, { teszt_uzem: 'true' }, { teszt_uzem: 1 }, 'x', []]) {
      expect(tesztUzemSav(ervenyesKonfig(rossz)), JSON.stringify(rossz)).toBeNull();
    }
    expect(tesztUzemSav(ervenyesKonfig({ teszt_uzem: false, kartyas_fizetes: 'eles' }))).toBeNull();
    expect(tesztUzemSav(ervenyesKonfig({ teszt_uzem: false, kartyas_fizetes: null }))).toBeNull();
  });

  it('stub-üzem: szimuláció; CIB teszt: a bank tesztkörnyezete — mindkettő pontos szöveggel', () => {
    const stub = tesztUzemSav(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: null }))!;
    expect(stub.fajta).toBe('stub');
    expect(stub.szoveg).toMatch(/szimuláció/);
    const cibTeszt = tesztUzemSav(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: 'teszt' }))!;
    expect(cibTeszt.fajta).toBe('cib_teszt');
    expect(cibTeszt.szoveg).toMatch(/CIB Bank tesztkörnyezet/);
    expect(cibTeszt.szoveg).toMatch(/valódi terhelés nincs/);
  });

  it('éles kártyás fizetés mellett a teszt-jelzés NEM állíthatja, hogy nincs valódi pénzmozgás', () => {
    for (const kf of ['eles', 'ismeretlen']) {
      const s = tesztUzemSav(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: kf }))!;
      expect(s, kf).not.toBeNull();
      expect(s.szoveg).not.toMatch(/nincs valódi|valódi pénzmozgás nincs|valódi terhelés nincs|szimuláció/);
    }
  });
});

// 2026-10-03 (a PR-5 web 1. javítóköre) — az átnézés nem blokkoló, de olcsó
// és egyértelmű pontjai.
describe('1. javítókör', () => {
  it('a publikus konfigurációból hiányzó kartyas_fizetes kulcs nem „szimuláció" (fail-closed)', () => {
    // A szerződés szerint a mező mindig jelen van; ha mégsem, a legmegengedőbb
    // állítás („valódi pénzmozgás nincs") nem jelenhet meg.
    expect(ervenyesKonfig({ teszt_uzem: true })).toBeNull();
    expect(tesztUzemSav(ervenyesKonfig({ teszt_uzem: true }))).toBeNull();
    expect(ervenyesKonfig({ teszt_uzem: true, kartyas_fizetes: null })).toEqual({ teszt_uzem: true, kartyas_fizetes: null });
  });

  it('a szünetelés nem állítja, hogy nem történt terhelés (egy már elindított fizetés lezárulhat)', () => {
    const u = fizetesTiltasUzenet(cib({ can_pay: false, pay_blocked_reason: 'szunetel' }) as any)!;
    expect(u.szoveg).not.toMatch(/nem történt terhelés/i);
    // (2. javítókör: lezárást sem ígér — hiányos konfignál a kör nem fut;
    // őre: cib-pr5-fix2.test.ts.)
    expect(u.szoveg).toMatch(/ne indíts újat/);
  });

  it('a sikertelen kísérlet magyarázata nem ígér feltétel nélkül új fizetést (az újrapróbát a felület külön kínálja)', () => {
    for (const rc of [null, '', 'ZZ', '05', '51', '91', 'X0', 'TO', '08']) {
      for (const p of ugyfelUzenet({ rc }).pontok) expect(p, String(rc)).not.toMatch(/bármikor indíthatsz/);
    }
  });
});
