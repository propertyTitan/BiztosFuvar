import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from './api';

// A request() wrapper a lelke a web↔backend hídnak: ő rakja rá a tokent,
// és ő dobja a globális eseményeket (kijelentkezés, KYC, coverage), amikre
// a KycModal és társai figyelnek. Ezt teszteljük mockolt fetch-csel.

const TOKEN_KEY = 'gofuvar_token';
const USER_KEY = 'gofuvar_user';

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response;
}

let dispatchSpy: ReturnType<typeof vi.spyOn>;
let originalLocation: Location;

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  // 401-nél a wrapper window.location.href-et állít → jsdom-ban navigáció,
  // ezt egy sima objektummal helyettesítjük, hogy ne dobjon.
  originalLocation = window.location;
  // @ts-expect-error – teszt-célú felülírás
  delete (window as any).location;
  (window as any).location = { href: '' };
});

afterEach(() => {
  (window as any).location = originalLocation;
});

describe('api.request wrapper', () => {
  it('sikeres válasznál a JSON-t adja vissza', async () => {
    const data = [{ id: 'r1', stars: 5 }];
    global.fetch = vi.fn().mockResolvedValue(mockResponse(200, data));
    const result = await api.getReviews({ job_id: 'j1' });
    expect(result).toEqual(data);
  });

  it('a tárolt tokent Authorization fejlécként küldi', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'abc123');
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, []));
    global.fetch = fetchMock;
    await api.getReviews({ job_id: 'j1' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer abc123');
  });

  it('token nélkül nincs Authorization fejléc', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, []));
    global.fetch = fetchMock;
    await api.getReviews({ job_id: 'j1' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('401-nél kijelentkeztet, eseményt dob és átirányít', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'expired');
    window.localStorage.setItem(USER_KEY, '{"id":"u1"}');
    global.fetch = vi.fn().mockResolvedValue(mockResponse(401, { error: 'unauthorized' }));

    await expect(api.getReviews({ job_id: 'j1' })).rejects.toThrow(/munkameneted lejárt/);

    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(window.localStorage.getItem(USER_KEY)).toBeNull();
    expect(window.location.href).toBe('/bejelentkezes');
    const evt = dispatchSpy.mock.calls.find(([e]) => (e as Event).type === 'gofuvar:session-expired');
    expect(evt).toBeTruthy();
  });

  it('403 + KYC kód → gofuvar:kyc-required eseményt dob a kóddal', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse(403, { error: 'kyc kell', code: 'IDENTITY_KYC_REQUIRED' }));

    await expect(api.getReviews({ job_id: 'j1' })).rejects.toThrow('kyc kell');

    const evt = dispatchSpy.mock.calls
      .map(([e]) => e as CustomEvent)
      .find((e) => e.type === 'gofuvar:kyc-required');
    expect(evt).toBeTruthy();
    expect(evt!.detail.code).toBe('IDENTITY_KYC_REQUIRED');
  });

  it('403 + OUTSIDE_COVERAGE → gofuvar:outside-coverage eseményt dob', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse(403, { error: 'lefedettségen kívül', code: 'OUTSIDE_COVERAGE' }));

    await expect(api.getReviews({ job_id: 'j1' })).rejects.toThrow('lefedettségen kívül');

    const evt = dispatchSpy.mock.calls
      .map(([e]) => e as CustomEvent)
      .find((e) => e.type === 'gofuvar:outside-coverage');
    expect(evt).toBeTruthy();
    expect(evt!.detail.error).toBe('lefedettségen kívül');
  });

  it('403 ismeretlen kóddal nem dob KYC/coverage eseményt, csak hibát', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(403, { error: 'tiltva', code: 'SOMETHING_ELSE' }));

    await expect(api.getReviews({ job_id: 'j1' })).rejects.toThrow('tiltva');

    const kyc = dispatchSpy.mock.calls
      .map(([e]) => e as Event)
      .find((e) => e.type === 'gofuvar:kyc-required' || e.type === 'gofuvar:outside-coverage');
    expect(kyc).toBeUndefined();
  });

  it('egyéb hibánál a backend error üzenetét dobja', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockResponse(500, { error: 'szerverhiba' }));
    await expect(api.getReviews({ job_id: 'j1' })).rejects.toThrow('szerverhiba');
  });
});
