import { describe, it, expect } from 'vitest';
import {
  kartyaAllapot, fizetesHibaUzenet, kovetkezoLekeresMs, vegleges, percKiiras,
  biztonsagosAtiranyitasiCel, lekerdezesFolytathato, LEKERDEZES_PLAFON_MS, atmenetiHiba,
} from './cibFizetes';
import { IDOTULLEPES_UZENET, HALOZATI_HIBA_UZENET } from '@/api';

const cib = (x: Record<string, unknown> = {}) => ({
  provider_kind: 'cib' as const, can_pay: true, open_attempt: null, last_result: null, ...x,
});

describe('a díjfizetési kártya állapota a GET /jobs/:id/fee-payment válaszából', () => {
  it('stub vagy hiányzó válasz: a mai felület (alap)', () => {
    expect(kartyaAllapot(null)).toBe('alap');
    expect(kartyaAllapot({ provider_kind: 'stub', can_pay: true, open_attempt: null, last_result: null })).toBe('alap');
    expect(kartyaAllapot(cib())).toBe('alap');
  });

  it('vissza nem tért kísérlet (a bank oldala bezárva): sárga sáv, de fizethet', () => {
    const oa = { trid: '1234567812345678', started_at: '2026-09-29T10:00:00Z', allapot: 'feldolgozas' };
    expect(kartyaAllapot(cib({ open_attempt: oa, can_pay: true }))).toBe('nyitott');
    expect(kartyaAllapot(cib({ open_attempt: { ...oa, allapot: 'redirected' } }))).toBe('nyitott');
  });

  it('a lezárás fut (authorized / closing / closed_ok): a gomb rejtve', () => {
    const oa = { trid: '1', started_at: '2026-09-29T10:00:00Z', allapot: 'feldolgozas' };
    expect(kartyaAllapot(cib({ open_attempt: oa, can_pay: false }))).toBe('lezaras');
    expect(kartyaAllapot(cib({ open_attempt: { ...oa, allapot: 'closing' } }))).toBe('lezaras');
  });

  it('kétes lezárás: „Ne fizess újra" (ellenorzes)', () => {
    const oa = { trid: '1', started_at: '2026-09-29T10:00:00Z', allapot: 'ellenorzes' };
    expect(kartyaAllapot(cib({ open_attempt: oa, can_pay: false }))).toBe('ellenorzes');
    expect(kartyaAllapot(cib({ last_result: { trid: '1', allapot: 'ellenorzes' } }))).toBe('ellenorzes');
  });

  it('SIKERES díjfizetés: külön állapot, NEM lezárás (különben a kártya sosem lép ki a lekérdezésből)', () => {
    // A javítás előtt a 'sikeres' a lezárás-halmazban volt: a kártya
    // „A fizetés lezárása folyamatban…"-t mutatott, 5 mp-enként végtelenül
    // kérdezett, és a fuvart sosem töltötte újra.
    expect(kartyaAllapot(cib({ last_result: { trid: '1', rc: '00', anum: 'AB1234', allapot: 'sikeres' } }))).toBe('sikeres');
    expect(kartyaAllapot(cib({ can_pay: false, last_result: { trid: '1', allapot: 'sikeres' } }))).toBe('sikeres');
    expect(kartyaAllapot(cib({ open_attempt: { trid: '1', started_at: '2026-09-29T10:00:00Z', allapot: 'sikeres' } }))).toBe('sikeres');
    // A banki lezárás utáni, még függő könyvelés (closed_ok) marad lezárás.
    expect(kartyaAllapot(cib({ open_attempt: { trid: '1', started_at: '2026-09-29T10:00:00Z', allapot: 'closed_ok' } }))).toBe('lezaras');
  });

  it('előző kísérlet sikertelen / nem terhelt: magyarázat + azonnali újrapróba', () => {
    for (const allapot of ['sikertelen', 'nem_terhelt', 'mar_fizetve']) {
      expect(kartyaAllapot(cib({ last_result: { trid: '1', rc: '05', allapot } }))).toBe('elozo_sikertelen');
    }
  });
});

describe('fizetési hibakódok → FIX magyar szöveg (nyers hiba soha)', () => {
  const kodok: Array<[string, number]> = [
    ['STATE_CHANGED', 409], ['PAYMENT_RECONCILIATION_REQUIRED', 409], ['CIB_PAYMENT_FINISHING', 409],
    ['CIB_PAYMENT_REVIEW', 409], ['PAYMENT_STARTING', 409], ['FEE_PAYMENT_FINALIZING', 409],
    ['PAYMENT_RETRY_LIMIT', 429], ['CIB_INIT_FAILED', 502], ['PAYMENT_START_FAILED', 502],
    ['CIB_BUSY', 503], ['CIB_UNAVAILABLE', 503], ['PAYMENT_TEMPORARILY_UNAVAILABLE', 503],
    ['CIB_CONSENT_REQUIRED', 400],
  ];

  it.each(kodok)('%s (%i): saját szöveg, a szerver üzenete nem jut át', (code, status) => {
    const u = fizetesHibaUzenet({ code, status, message: 'SZERVER-BELSŐ-SZÖVEG ECONNRESET 10.0.0.1' });
    expect(u.szoveg).not.toMatch(/SZERVER-BELSŐ|ECONNRESET|10\.0\.0\.1/);
    expect(u.cim.length).toBeGreaterThan(3);
    expect(u.szoveg.length).toBeGreaterThan(10);
  });

  it('minden kódnak KÜLÖN szövege van (nem egy közös általános)', () => {
    const szovegek = new Set(kodok.map(([code, status]) => fizetesHibaUzenet({ code, status }).szoveg));
    expect(szovegek.size).toBe(kodok.length);
  });

  it('CIB_CONSENT_REQUIRED (2026-10-01): a CIB felé történő adattovábbítási nyilatkozatot kéri, nem az azonnali teljesítésit', () => {
    const u = fizetesHibaUzenet({ code: 'CIB_CONSENT_REQUIRED', status: 400 });
    expect(u.szoveg).toBe('A bankkártyás fizetéshez el kell fogadnod a CIB Bank felé történő adattovábbításról szóló nyilatkozatot.');
    expect(u.szoveg).not.toBe(fizetesHibaUzenet({ code: 'CONSENT_REQUIRED', status: 400 }).szoveg);
    expect(u.teendo).toBeNull();
  });

  it('CIB_INIT_FAILED: a terv szerinti szó szerinti mondat', () => {
    expect(fizetesHibaUzenet({ code: 'CIB_INIT_FAILED', status: 502 }).szoveg)
      .toBe('A bank most nem érhető el, nem történt terhelés. Próbáld újra pár perc múlva.');
  });

  it('a lezárás alatti ütközés az állapot újraolvasását kéri, a STATE_CHANGED a fuvarét', () => {
    expect(fizetesHibaUzenet({ code: 'CIB_PAYMENT_FINISHING' }).teendo).toBe('allapot');
    expect(fizetesHibaUzenet({ code: 'CIB_PAYMENT_REVIEW' }).teendo).toBe('allapot');
    expect(fizetesHibaUzenet({ code: 'STATE_CHANGED' }).teendo).toBe('fuvar');
  });

  it('időtúllépés (55 s): „Nem sikerült elindítani, nem történt terhelés"', () => {
    const u = fizetesHibaUzenet({ message: IDOTULLEPES_UZENET });
    expect(u.szoveg).toMatch(/Nem sikerült elindítani, nem történt terhelés/);
  });

  it('hálózati hiba: saját szöveg', () => {
    expect(fizetesHibaUzenet({ message: HALOZATI_HIBA_UZENET }).szoveg).toMatch(/nem történt terhelés/);
  });

  it('ismeretlen kód: általános fix szöveg, a nyers üzenet nem jut át', () => {
    const u = fizetesHibaUzenet({ code: 'VALAMI_UJ', status: 500, message: 'TypeError: x is undefined' });
    expect(u.szoveg).not.toMatch(/TypeError/);
    expect(u.szoveg).toMatch(/nem történt terhelés/);
  });
});

describe('eredményoldal-lekérdezés ütemezése', () => {
  it('3 percig 3 másodpercenként, utána 20 másodpercenként', () => {
    expect(kovetkezoLekeresMs(0)).toBe(3000);
    expect(kovetkezoLekeresMs(179_999)).toBe(3000);
    expect(kovetkezoLekeresMs(180_000)).toBe(20_000);
    expect(kovetkezoLekeresMs(3_600_000)).toBe(20_000);
  });

  it('felső korlát: 30 perc után az automatikus lekérdezés leáll', () => {
    expect(LEKERDEZES_PLAFON_MS).toBe(30 * 60_000);
    expect(lekerdezesFolytathato(0)).toBe(true);
    expect(lekerdezesFolytathato(29 * 60_000)).toBe(true);
    expect(lekerdezesFolytathato(30 * 60_000)).toBe(false);
    expect(lekerdezesFolytathato(24 * 3_600_000)).toBe(false);
  });

  it('csak a „feldolgozas" nem végleges', () => {
    expect(vegleges('feldolgozas')).toBe(false);
    for (const a of ['sikeres', 'sikertelen', 'nem_terhelt', 'mar_fizetve', 'ellenorzes']) {
      expect(vegleges(a)).toBe(true);
    }
  });
});

describe('segédek', () => {
  it('perc-kiírás a sárga sávhoz', () => {
    const most = Date.parse('2026-09-29T10:10:00Z');
    expect(percKiiras('2026-09-29T10:07:00Z', most)).toBe('3 perce');
    expect(percKiiras('2026-09-29T10:09:50Z', most)).toBe('néhány másodperce');
    expect(percKiiras('nem-dátum', most)).toBe('nemrég');
  });

  it('átmeneti hiba (újrapróbálandó): 5xx, 429, időtúllépés, hálózat — a 401/403/404 és a programhiba nem', () => {
    for (const status of [500, 502, 503, 504, 429]) expect(atmenetiHiba({ status })).toBe(true);
    expect(atmenetiHiba({ message: IDOTULLEPES_UZENET })).toBe(true);
    expect(atmenetiHiba({ message: HALOZATI_HIBA_UZENET })).toBe(true);
    for (const status of [400, 401, 403, 404, 409]) expect(atmenetiHiba({ status })).toBe(false);
    expect(atmenetiHiba(new TypeError('api.getFeePayment is not a function'))).toBe(false);
    expect(atmenetiHiba(null)).toBe(false);
  });

  it('átirányítani csak http(s) címre szabad (javascript: soha)', () => {
    expect(biztonsagosAtiranyitasiCel('https://api.gofuvar.hu/payments/cib/tovabb/abc')).toBe(true);
    expect(biztonsagosAtiranyitasiCel('http://localhost:4100/payments/cib/tovabb/abc')).toBe(true);
    expect(biztonsagosAtiranyitasiCel('javascript:alert(1)')).toBe(false);
    expect(biztonsagosAtiranyitasiCel('')).toBe(false);
    expect(biztonsagosAtiranyitasiCel(null)).toBe(false);
  });
});
