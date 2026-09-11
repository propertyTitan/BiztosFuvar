import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PROFIL-CACHE őr (2026-09-11, teljes audit B1): öt komponens hívta a
// /auth/me-t minden oldalbetöltéskor — a cache egy kérésre vonja össze,
// a profil-módosítás és a fiókváltás pedig frissre kényszeríti.
import { api } from '@/api';

const valasz = (body: unknown) => ({
  ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body),
});

describe('api.getMyProfile cache', () => {
  let eredetiFetch: typeof fetch;
  beforeEach(() => {
    eredetiFetch = global.fetch;
    window.localStorage.setItem('gofuvar_token', 'token-A');
    api.invalidateMyProfile();
  });
  afterEach(() => { global.fetch = eredetiFetch; window.localStorage.clear(); vi.restoreAllMocks(); });

  it('rövid időn belül több hívás EGY hálózati kérés; invalidálás után újra kér', async () => {
    const f = vi.fn(async () => valasz({ id: 'u1', phone: null }));
    global.fetch = f as unknown as typeof fetch;
    const [a, b, c] = await Promise.all([api.getMyProfile(), api.getMyProfile(), api.getMyProfile()]);
    expect(f, 'három párhuzamos profil-kérés három hálózati hívást indított').toHaveBeenCalledTimes(1);
    expect(a).toEqual(b); expect(b).toEqual(c);
    api.invalidateMyProfile();
    await api.getMyProfile();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('a profil-módosítás (PATCH) után friss profil jön; fiókváltásnál (más token) nem szivárog', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => (init?.method === 'PATCH' ? valasz({ ok: true }) : valasz({ id: 'u1' })));
    global.fetch = f as unknown as typeof fetch;
    await api.getMyProfile();
    await api.updateMyProfile({ phone: '+36201234567' });
    await api.getMyProfile();
    expect(f.mock.calls.filter(([, init]) => !init || init.method !== 'PATCH').length, 'PATCH után a régi (telefon nélküli) profil maradt a cache-ben').toBe(2);
    window.localStorage.setItem('gofuvar_token', 'token-B');
    await api.getMyProfile();
    expect(f.mock.calls.filter(([, init]) => !init || init.method !== 'PATCH').length, 'másik fiók tokenjével a régi fiók profilja jött vissza a cache-ből').toBe(3);
  });

  it('fresh: true mindig hálózatra megy', async () => {
    const f = vi.fn(async () => valasz({ id: 'u1' }));
    global.fetch = f as unknown as typeof fetch;
    await api.getMyProfile();
    await api.getMyProfile({ fresh: true });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
