import { beforeEach, expect, it, vi } from 'vitest';
import { clearHozasdEl, emptyHozasdElDraft, HOZASD_EL_DRAFT, HOZASD_EL_PREFILL, readHozasdEl, saveHozasdEl } from './hozasdEl';

beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

it('a vendég adatai belépés után átvehetők, a fiókhoz kötött adatok másik fiókban nem', () => {
  const draft = { ...emptyHozasdElDraft(), title: 'Kanapé', ready: true };
  saveHozasdEl(HOZASD_EL_PREFILL, draft, null);
  expect(readHozasdEl(HOZASD_EL_PREFILL, 'sender-1')?.title).toBe('Kanapé');
  saveHozasdEl(HOZASD_EL_PREFILL, draft, 'sender-1');
  expect(readHozasdEl(HOZASD_EL_PREFILL, 'sender-2')).toBeNull();
  expect(sessionStorage.getItem(HOZASD_EL_PREFILL)).toBeNull();
});

it('a lejárt és sérült munkamenetet eldobja', () => {
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now - 25 * 60 * 60 * 1000);
  saveHozasdEl(HOZASD_EL_DRAFT, emptyHozasdElDraft(), null);
  vi.mocked(Date.now).mockReturnValue(now);
  expect(readHozasdEl(HOZASD_EL_DRAFT, null)).toBeNull();
  sessionStorage.setItem(HOZASD_EL_DRAFT, '{');
  expect(readHozasdEl(HOZASD_EL_DRAFT, null)).toBeNull();
});

it('nem állít vissza idegen képhostot vagy érvénytelen, megerősített koordinátát', () => {
  saveHozasdEl(HOZASD_EL_DRAFT, { ...emptyHozasdElDraft(),
    image: 'https://ikea.com.evil.example/image.jpg',
    pickup: { address: 'Budapest', lat: 100, lng: 19, confirmed: true },
  }, null);
  expect(readHozasdEl(HOZASD_EL_DRAFT, null)).toMatchObject({ image: '', pickup: { lat: null, lng: null, confirmed: false } });
});

it('tiltott tárolónál jelez, törléskor mindkét munkamenetkulcsot eltávolítja', () => {
  saveHozasdEl(HOZASD_EL_DRAFT, emptyHozasdElDraft(), null);
  saveHozasdEl(HOZASD_EL_PREFILL, emptyHozasdElDraft(), null);
  clearHozasdEl();
  expect(sessionStorage.length).toBe(0);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  expect(saveHozasdEl(HOZASD_EL_PREFILL, emptyHozasdElDraft(), null)).toBe(false);
});
