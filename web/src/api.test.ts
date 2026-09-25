import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { api, IDOTULLEPES_UZENET, type Bid } from './api';

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

let dispatchSpy: MockInstance<(event: Event) => boolean>;
let originalLocation: Location;

it.each(['acceptBid', 'acceptCounter'] as const)('%s a megjelenített ajánlat verzióját és árát küldi', async (action) => {
  const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { ok: true }));
  global.fetch = fetchMock;
  const bid = { id: 'bid', revision: 7, amount_huf: 20000, counter_amount_huf: 15000,
    counter_by: action === 'acceptBid' ? 'carrier' : 'shipper' } as Bid;
  await api[action](bid);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ expected_revision: 7, expected_amount_huf: 15000 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  dispatchSpy = vi.spyOn(window, 'dispatchEvent');
  // 401-nél a wrapper window.location.href-et állít → jsdom-ban navigáció,
  // ezt egy sima objektummal helyettesítjük, hogy ne dobjon.
  originalLocation = window.location;
  delete (window as any).location;
  (window as any).location = { href: '' };
});

afterEach(() => {
  vi.useRealTimers();
  (window as any).location = originalLocation;
});

describe('Profil műveletek közös kéréskezelése', () => {
  const avatar = new File(['photo'], 'avatar.jpg', { type: 'image/jpeg' });
  const operations = [
    ['profilkép', () => api.uploadAvatar(avatar)],
    ['export', () => api.exportMyData()],
    ['fióktörlés', () => api.deleteMyAccount()],
  ] as const;

  it.each(operations)('%s: lejárt token törli a munkamenetet', async (_name, operation) => {
    localStorage.setItem(TOKEN_KEY, 'expired');
    localStorage.setItem(USER_KEY, '{"id":"u"}');
    global.fetch = vi.fn().mockResolvedValue(mockResponse(401, {}));
    await expect(operation()).rejects.toThrow('munkameneted lejárt');
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'gofuvar:session-expired' }));
  });

  it.each(operations)('%s: beragadt kérésből magyar időtúllépési hiba lesz', async (_name, operation) => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('abort')));
    })) as typeof fetch;
    const assertion = expect(operation()).rejects.toThrow(IDOTULLEPES_UZENET);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('a profilképet multipart határ kézi felülírása nélkül küldi', async () => {
    localStorage.setItem(TOKEN_KEY, 'valid');
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { url: '/uploads/avatar.jpg' }));
    global.fetch = fetchMock;
    expect(await api.uploadAvatar(avatar)).toEqual({ url: '/uploads/avatar.jpg' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/avatar$/);
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.headers.Authorization).toBe('Bearer valid');
    expect(init.body.get('file')).toBe(avatar);
  });

  it('az export JSON-t megőrzi, a szerver hibaszövegét továbbadja', async () => {
    const data = { profile: { id: 'u' }, fee_payment_receipts: [{ amount_huf: 500 }] };
    global.fetch = vi.fn().mockResolvedValueOnce(mockResponse(200, data))
      .mockResolvedValueOnce(mockResponse(409, { error: 'Aktív fuvar mellett nem törölhető a fiók.' }));
    expect(await api.exportMyData()).toEqual(data);
    await expect(api.deleteMyAccount()).rejects.toThrow('Aktív fuvar mellett nem törölhető a fiók.');
  });
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

  it.each(['old-a', null])('késői 401 nem törli a közben belépett új sessiont: korábbi token=%s', async oldToken => {
    if (oldToken) localStorage.setItem(TOKEN_KEY, oldToken);
    let finish!: (response: Response) => void;
    global.fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const pending = api.getReviews({ job_id: 'old-job' });
    localStorage.setItem(TOKEN_KEY, 'new-b');
    localStorage.setItem(USER_KEY, '{"id":"b"}');
    finish(mockResponse(401, { error: 'unauthorized' }));
    await expect(pending).rejects.toThrow('munkamenet megváltozott');
    expect(localStorage.getItem(TOKEN_KEY)).toBe('new-b');
    expect(localStorage.getItem(USER_KEY)).toBe('{"id":"b"}');
    expect(window.location.href).toBe('');
    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gofuvar:session-expired' }));
  });

  it.each([200, 403])('a régi session későn beolvasott JSON-ja nem kerül az új felületre és nem nyit kaput: %s', async status => {
    localStorage.setItem(TOKEN_KEY, 'old-a');
    let finish!: (body: unknown) => void;
    const body = new Promise(resolve => { finish = resolve; });
    const reading = vi.fn(() => body);
    global.fetch = vi.fn().mockResolvedValue({ ...mockResponse(status, {}), json: reading });
    const pending = api.getReviews({ job_id: 'old-job' });
    await vi.waitFor(() => expect(reading).toHaveBeenCalledOnce());
    localStorage.setItem(TOKEN_KEY, 'new-b');
    finish(status === 200 ? { private: 'Anna adata' } : { error: 'KYC kell', code: 'IDENTITY_KYC_REQUIRED' });
    await expect(pending).rejects.toThrow('munkamenet megváltozott');
    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'gofuvar:kyc-required' }));
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
