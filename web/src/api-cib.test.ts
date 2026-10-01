import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api, IDOTULLEPES_UZENET } from './api';

// A CIB kártyás díjfizetés API-hívásai (PR-3, web). A backend ugyanerre a
// szerződésre épül párhuzamosan — itt a web oldali fele: időkeret, bearer
// nélküli eredmény-lekérdezés, a hibakód továbbjutása.

function valasz(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, statusText: '', json: async () => body } as unknown as Response;
}

let eredetiLocation: Location;
beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  eredetiLocation = window.location;
  delete (window as any).location;
  (window as any).location = { href: '' };
});
afterEach(() => {
  vi.useRealTimers();
  (window as any).location = eredetiLocation;
});

describe('payJob — 55 másodperces keret', () => {
  it('az alap 15 mp-nél NEM szakad meg (a bank-inicializálás 40 mp is lehet), 55 mp-nél igen', async () => {
    vi.useFakeTimers();
    let megszakitva = false;
    global.fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal?.addEventListener('abort', () => { megszakitva = true; rej(new DOMException('aborted', 'AbortError')); });
    })) as any;
    const igeret = api.payJob('job-1', true);
    const eredmeny = igeret.catch((e) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(megszakitva).toBe(false);
    await vi.advanceTimersByTimeAsync(35_500);
    expect(megszakitva).toBe(true);
    expect((await eredmeny).message).toBe(IDOTULLEPES_UZENET);
  });

  it('a CIB-válasz átjön (redirect_url, trid, provider)', async () => {
    global.fetch = vi.fn().mockResolvedValue(valasz(200, {
      provider: 'cib', trid: '1234567812345678', fee_huf: 500,
      redirect_url: 'https://api.gofuvar.hu/payments/cib/tovabb/tok', gateway_url: 'https://api.gofuvar.hu/payments/cib/tovabb/tok',
      is_stub: false, reused: false,
    }));
    const r = await api.payJob('job-1', true);
    expect(r.provider).toBe('cib');
    expect(r.redirect_url).toMatch(/tovabb/);
  });

  it('a hibakód és a státusz eljut a hívóhoz (a kártya ebből választ fix szöveget)', async () => {
    global.fetch = vi.fn().mockResolvedValue(valasz(503, { error: 'x', code: 'CIB_UNAVAILABLE' }));
    await expect(api.payJob('job-1', true)).rejects.toMatchObject({ code: 'CIB_UNAVAILABLE', status: 503 });
  });

  // 2026-10-01 (a CIB írásos válasza): a kártyás úton az adattovábbítási
  // nyilatkozat is kötelező — a backend nélküle 400 CIB_CONSENT_REQUIRED-et ad.
  it('CIB-úton a kérés a cib_adatkezelesi_hozzajarulas: true mezőt is viszi; a stub-úton nem', async () => {
    const f = vi.fn().mockResolvedValue(valasz(200, { provider: 'cib', redirect_url: 'https://x.hu/a' }));
    global.fetch = f;
    await api.payJob('job-1', true, true);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ consent: true, cib_adatkezelesi_hozzajarulas: true });
    expect(f.mock.calls[0][1].method).toBe('POST');
    await api.payJob('job-1', true);
    expect(JSON.parse(f.mock.calls[1][1].body)).toEqual({ consent: true });
  });
});

describe('getFeePayment', () => {
  it('a fuvar díjfizetési állapotát kéri, bearerrel', async () => {
    window.localStorage.setItem('gofuvar_token', 'tok-1');
    const f = vi.fn().mockResolvedValue(valasz(200, { provider_kind: 'cib', can_pay: true, open_attempt: null, last_result: null }));
    global.fetch = f;
    const r = await api.getFeePayment('job-9');
    expect(r.provider_kind).toBe('cib');
    expect(String(f.mock.calls[0][0])).toMatch(/\/jobs\/job-9\/fee-payment$/);
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-1');
  });
});

describe('getCibEredmeny — belépés nélkül is', () => {
  it('bearer NÉLKÜL megy (PWA→Safari, beépített böngésző), a token URL-kódolva', async () => {
    window.localStorage.setItem('gofuvar_token', 'tok-1');
    const f = vi.fn().mockResolvedValue(valasz(200, { allapot: 'sikeres', trid: '1' }));
    global.fetch = f;
    await api.getCibEredmeny('a.b+c/d');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toMatch(/\/payments\/cib\/eredmeny\?e=a\.b%2Bc%2Fd$/);
    const fejlecek = (init?.headers || {}) as Record<string, string>;
    expect(fejlecek.Authorization).toBeUndefined();
  });

  it('404 (lejárt / rossz token): NEM léptet ki, kódolt hibát ad', async () => {
    window.localStorage.setItem('gofuvar_token', 'tok-1');
    global.fetch = vi.fn().mockResolvedValue(valasz(404, { error: 'nincs' }));
    await expect(api.getCibEredmeny('rossz')).rejects.toMatchObject({ status: 404 });
    expect(window.localStorage.getItem('gofuvar_token')).toBe('tok-1');
  });

  it('401-re sem léptet ki (a végpont publikus, a munkamenethez nincs köze)', async () => {
    window.localStorage.setItem('gofuvar_token', 'tok-1');
    global.fetch = vi.fn().mockResolvedValue(valasz(401, {}));
    await expect(api.getCibEredmeny('x')).rejects.toBeTruthy();
    expect(window.localStorage.getItem('gofuvar_token')).toBe('tok-1');
  });
});

describe('admin CIB-hívások', () => {
  it('kereső: a paraméterek a query stringbe kerülnek', async () => {
    const f = vi.fn().mockResolvedValue(valasz(200, { items: [], total: 0 }));
    global.fetch = f;
    await api.adminCibKereses({ q: '1234 5678', allapot: 'ellenorzes', from: '2026-09-01', to: '2026-09-29', limit: 25, offset: 50 });
    const url = new URL(String(f.mock.calls[0][0]));
    expect(url.pathname).toBe('/payments/admin/cib');
    expect(url.searchParams.get('q')).toBe('1234 5678');
    expect(url.searchParams.get('allapot')).toBe('ellenorzes');
    expect(url.searchParams.get('from')).toBe('2026-09-01');
    expect(url.searchParams.get('to')).toBe('2026-09-29');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.get('offset')).toBe('50');
  });

  it('részlet, újraellenőrzés, rendezés a helyes útvonalra megy', async () => {
    const f = vi.fn().mockResolvedValue(valasz(200, { ok: true, allapot: 'failed' }));
    global.fetch = f;
    await api.adminCibReszlet('1234567812345678');
    await api.adminCibUjraellenorzes('1234567812345678');
    await api.adminCibRendezes('1234567812345678', { eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette.', anum: 'AB1234' });
    expect(String(f.mock.calls[0][0])).toMatch(/\/payments\/admin\/cib\/1234567812345678$/);
    expect(String(f.mock.calls[1][0])).toMatch(/\/payments\/admin\/cib\/1234567812345678\/ujraellenorzes$/);
    expect(f.mock.calls[1][1].method).toBe('POST');
    expect(String(f.mock.calls[2][0])).toMatch(/\/rendezes$/);
    expect(JSON.parse(f.mock.calls[2][1].body)).toEqual({ eredmeny: 'lezarva', indoklas: 'A bank írásban megerősítette.', anum: 'AB1234' });
  });
});
