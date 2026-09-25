import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCurrentUser, setCurrentUser, watchSessionChanges } from './auth';
import { clearHozasdEl, emptyHozasdElDraft, HOZASD_EL_PREFILL, readHozasdEl, saveHozasdEl } from './hozasdEl';

const sockets = vi.hoisted(() => ({ disconnect: vi.fn(), refresh: vi.fn() }));
vi.mock('./socket', () => ({ disconnectSocket: sockets.disconnect, refreshSocketAuth: sockets.refresh }));
const a = { id: 'a', email: 'a@example.test', role: 'shipper' as const };
const b = { id: 'b', email: 'b@example.test', role: 'shipper' as const };
let stop: (() => void) | undefined;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { stop?.(); stop = undefined; clearHozasdEl(); });
const storage = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }));

describe('A07: központi fiókhatár', () => {
  it('másik tab közvetlen fiókcseréjénél előbb bont, majd tiszta oldalt kér, régi tab-piszkozat nélkül', () => {
    setCurrentUser(a, 'token-a');
    saveHozasdEl(HOZASD_EL_PREFILL, { ...emptyHozasdElDraft(), title: 'Anna saját csomagja' }, a.id);
    sockets.disconnect.mockClear();
    const reset = vi.fn(() => {
      expect(sockets.disconnect).toHaveBeenCalledOnce();
      expect(sessionStorage.getItem(HOZASD_EL_PREFILL)).toBeNull();
    });
    stop = watchSessionChanges(reset);
    localStorage.setItem('gofuvar_user', JSON.stringify(b));
    localStorage.setItem('gofuvar_token', 'token-b');
    storage('gofuvar_user'); storage('gofuvar_token');
    expect(reset).toHaveBeenCalledTimes(1); expect(reset).toHaveBeenCalledWith('/');
  });

  it.each(['user-first', 'token-first', 'clear'])('kijelentkezés külön storage eseményei is egyetlen lezárást okoznak: %s', order => {
    setCurrentUser(a, 'token-a');
    const reset = vi.fn(); stop = watchSessionChanges(reset);
    if (order === 'clear') { localStorage.clear(); storage(null); }
    else {
      const keys = order === 'user-first' ? ['gofuvar_user', 'gofuvar_token'] : ['gofuvar_token', 'gofuvar_user'];
      for (const key of keys) { localStorage.removeItem(key); storage(key); }
    }
    expect(reset).toHaveBeenCalledTimes(1); expect(reset).toHaveBeenCalledWith('/');
  });

  it('saját kijelentkezés a memóriát is lezárja, ugyanazon fiók profilfrissítése nem', () => {
    setCurrentUser(a, 'token-a');
    const reset = vi.fn(); stop = watchSessionChanges(reset);
    setCurrentUser({ ...a, full_name: 'Anna' }, 'token-a');
    expect(reset).not.toHaveBeenCalled();
    clearCurrentUser();
    expect(reset).toHaveBeenCalledTimes(1); expect(reset).toHaveBeenCalledWith('/bejelentkezes');
  });

  it('saját vendég → login megtartja a Hozasd el folytatást; másik tab belépése tiszta oldalt kér', () => {
    saveHozasdEl(HOZASD_EL_PREFILL, { ...emptyHozasdElDraft(), title: 'Kanapé' }, null);
    const reset = vi.fn(); stop = watchSessionChanges(reset);
    setCurrentUser(a, 'token-a');
    expect(reset).not.toHaveBeenCalled();
    expect(readHozasdEl(HOZASD_EL_PREFILL, a.id)?.title).toBe('Kanapé');
    stop(); localStorage.clear(); stop = watchSessionChanges(reset);
    localStorage.setItem('gofuvar_user', JSON.stringify(b));
    localStorage.setItem('gofuvar_token', 'token-b');
    storage('gofuvar_token');
    expect(reset).toHaveBeenCalledTimes(1); expect(reset).toHaveBeenCalledWith('/');
  });

  it('ugyanazon fiók tokenfrissítése nem dobja el a képernyőt; felfüggesztett tab fiókcseréje igen', () => {
    setCurrentUser(a, 'token-a');
    const reset = vi.fn(); stop = watchSessionChanges(reset);
    sockets.refresh.mockClear();
    localStorage.setItem('gofuvar_token', 'renewed-a'); storage('gofuvar_token');
    expect(sockets.refresh).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    localStorage.setItem('gofuvar_user', JSON.stringify(b));
    localStorage.setItem('gofuvar_token', 'token-b');
    window.dispatchEvent(new Event('pageshow'));
    expect(reset).toHaveBeenCalledTimes(1); expect(reset).toHaveBeenCalledWith('/');
  });
});
