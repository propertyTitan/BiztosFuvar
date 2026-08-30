// =====================================================================
//  API-IDŐKERETEK — a „beragadó submit" osztály őre (2026-08-30)
//
//  A Manus-jelentés GF-001/002/003/012 tételeinek közös osztálya: a fetch-nek
//  nem volt időkerete, így egy elakadt kapcsolat ÖRÖKRE pörgő gombot hagyott
//  minden űrlapon — hibaüzenet és kiút nélkül. Ráadásul a hálózati hibák a
//  böngésző nyers, ANGOL szövegével („Failed to fetch") jutottak a
//  felhasználóig.
//
//  A védelem EGY helyen él (fetchWithTimeout), az összes űrlap örökli.
//  A kulcs-teszt VALÓDI beragadt szerverrel mér: a javítás nélkül a kérés
//  tényleg örökre függene (a teszt a saját időkeretén bukna el) — ez a
//  „nélküle piros" bizonyíték.
//
//  ⚠️ NODE-KÖRNYEZET, szándékosan: jsdom alatt az AbortController a jsdomé,
//  a fetch viszont a Node-é (undici), és az undici BRAND-ellenőrzi a signalt
//  („Expected signal to be an instance of AbortSignal") → azonnali TypeError.
//  Ez KIZÁRÓLAG a kevert teszt-realm műterméke — böngészőben és Next
//  SSR-ben a kettő ugyanabból a realmből jön. Node-környezetben a valódi
//  beragadt-szerver mérés a valós viselkedést adja.
// =====================================================================
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { api, fetchWithTimeout, HALOZATI_HIBA_UZENET, IDOTULLEPES_UZENET } from './api';

const realFetch = global.fetch;

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    // HTTP/2 alatt a statusText ÜRES — a mock szándékosan ezt a valós,
    // kellemetlen esetet hozza (a régi fallback pont ezen bukott el).
    statusText: '',
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('Beragadt kapcsolat (a GF-001/002/003/012 osztály gyökere)', () => {
  it('VALÓDI nem-válaszoló szerverre a kérés VÉGES időn belül magyar hibával tér vissza', async () => {
    // A szerver elfogadja a kapcsolatot, de SOHA nem válaszol — pontosan az
    // az eset, amiben a gomb korábban örökre pörgött volna.
    const zombiSzerver = http.createServer(() => { /* sosem válaszol */ });
    await new Promise<void>((resolve) => { zombiSzerver.listen(0, '127.0.0.1', resolve); });
    const port = (zombiSzerver.address() as { port: number }).port;

    try {
      await expect(
        fetchWithTimeout(`http://127.0.0.1:${port}/akarmi`, { timeoutMs: 300 }),
      ).rejects.toThrow(IDOTULLEPES_UZENET);
    } finally {
      zombiSzerver.closeAllConnections?.();
      await new Promise<void>((resolve) => { zombiSzerver.close(() => resolve()); });
    }
  }, 5000);

  it('minden kérés időkeret-jelzéssel (AbortSignal) indul', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    global.fetch = fetchMock;
    await api.getReviews({ job_id: 'j1' });
    const [, init] = fetchMock.mock.calls[0];
    expect(
      init.signal,
      'A kérés AbortSignal nélkül ment ki — időkeret nélkül egy elakadt '
      + 'kapcsolat örökre pörgő gombot hagy (a beragadó-submit osztály).',
    ).toBeInstanceOf(AbortSignal);
    expect(
      'timeoutMs' in init,
      'A timeoutMs belső opció kiszivárgott a fetch init-be — a fetch ezt '
      + 'nem érti, a fetchWithTimeout-nak kell kivennie.',
    ).toBe(false);
  });
});

describe('Magyar hibaüzenetek (nincs angol szöveg a felhasználó felé)', () => {
  it('időtúllépésnél magyar üzenet megy (a mock a valódi fetch-hez hasonlóan a signalra hallgat)', async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      }));
    await expect(fetchWithTimeout('http://teszt.local/x', { timeoutMs: 50 })).rejects.toThrow(IDOTULLEPES_UZENET);
  });

  it('hálózati hibánál magyar üzenet megy, nem „Failed to fetch"', async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    let uzenet = '';
    await api.login('a@b.hu', 'jelszo123').catch((e: Error) => { uzenet = e.message; });
    expect(uzenet).toBe(HALOZATI_HIBA_UZENET);
    expect(
      uzenet.includes('Failed to fetch'),
      'A böngésző nyers angol hibaszövege jutott el a felhasználóig.',
    ).toBe(false);
  });

  it('a 429-es rate-limit magyar üzenete változatlanul átjön', async () => {
    const backendUzenet = 'Túl sok belépési kísérlet. Kérlek várj egy percet.';
    global.fetch = vi.fn().mockResolvedValue(mockResponse(429, { error: backendUzenet }));
    await expect(api.login('a@b.hu', 'jelszo123')).rejects.toThrow(backendUzenet);
  });

  it('nem-JSON hibatest + üres statusText (HTTP/2) → státuszkódos magyar fallback', async () => {
    // A régi fallback a res.statusText-re esett, ami HTTP/2 alatt üres —
    // a felhasználó a semmitmondó „API hiba" szöveget kapta.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: '',
      json: async () => { throw new Error('nem JSON'); },
    } as unknown as Response);
    let uzenet = '';
    await api.getReviews({ job_id: 'j1' }).catch((e: Error) => { uzenet = e.message; });
    expect(uzenet).toContain('502');
    expect(uzenet).toContain('Próbáld újra');
  });
});
