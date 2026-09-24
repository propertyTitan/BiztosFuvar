import { beforeEach, expect, it, vi } from 'vitest';
import { clearHozasdEl, emptyHozasdElDraft, hozasdElContinuation, HOZASD_EL_DRAFT, HOZASD_EL_PREFILL, postingHozasdElKind, readHozasdEl, saveHozasdEl } from './hozasdEl';
import { mentPiszkozat, piszkozatKulcs, UJ_FUVAR_PISZKOZAT_ELOTAG } from './urlapPiszkozat';

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); vi.restoreAllMocks(); });

it('a vendég adatai belépés után átvehetők, a fiókhoz kötött adatok másik fiókban nem', () => {
  const draft = { ...emptyHozasdElDraft(), title: 'Kanapé', ready: true };
  saveHozasdEl(HOZASD_EL_PREFILL, draft, null);
  expect(readHozasdEl(HOZASD_EL_PREFILL, 'sender-1')?.title).toBe('Kanapé');
  saveHozasdEl(HOZASD_EL_PREFILL, draft, 'sender-1');
  expect(readHozasdEl(HOZASD_EL_PREFILL, 'sender-2')).toBeNull();
  expect(sessionStorage.getItem(HOZASD_EL_PREFILL)).toBeNull();
});

it('megőrzi a bútoros belépést, a korábbi és ismeretlen típus biztonságos alapértéket kap', () => {
  const draft = { ...emptyHozasdElDraft(), kind: 'furniture' as const };
  saveHozasdEl(HOZASD_EL_PREFILL, draft, null);
  expect(readHozasdEl(HOZASD_EL_PREFILL, null)?.kind).toBe('furniture');
  for (const kind of [undefined, 'unexpected']) {
    sessionStorage.setItem(HOZASD_EL_PREFILL, JSON.stringify({ v: 1, at: Date.now(), ownerId: null, data: { ...draft, kind } }));
    expect(readHozasdEl(HOZASD_EL_PREFILL, null)?.kind).toBe('general');
  }
  expect(postingHozasdElKind({ sourceStore: 'IKEA' })).toBe('general');
  expect(postingHozasdElKind({ sourceStore: 'unknown' })).toBeNull();
  expect(postingHozasdElKind({ sourceStore: { toString: 'invalid' } })).toBeNull();
});

it('a folytatás új fülben csak a saját Hozasd el piszkozatot találja meg', () => {
  const key = piszkozatKulcs(UJ_FUVAR_PISZKOZAT_ELOTAG, 'sender-1');
  mentPiszkozat(key, { form: { title: 'Saját kanapé' }, hozasdElKind: 'furniture' });
  expect(hozasdElContinuation('sender-1')).toEqual({ title: 'Saját kanapé' });
  expect(hozasdElContinuation('sender-2')).toBeNull();
  expect(hozasdElContinuation(null)).toBeNull();
  mentPiszkozat(key, { form: { title: 'Sima fuvarpiszkozat' } });
  expect(hozasdElContinuation('sender-1')).toBeNull();
});

it('a frissen átadott tárgyat jelzi, de lejárt feladáshoz nem kínál folytatást', () => {
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now - 8 * 24 * 60 * 60 * 1000);
  mentPiszkozat(piszkozatKulcs(UJ_FUVAR_PISZKOZAT_ELOTAG, 'sender-1'), {
    form: { title: 'Régi kanapé' }, hozasdElKind: 'furniture',
  });
  vi.mocked(Date.now).mockReturnValue(now);
  expect(hozasdElContinuation('sender-1')).toBeNull();
  saveHozasdEl(HOZASD_EL_PREFILL, { ...emptyHozasdElDraft(), title: 'Új asztal', ready: true }, null);
  expect(hozasdElContinuation(null)).toEqual({ title: 'Új asztal' });
  expect(hozasdElContinuation('sender-1')).toEqual({ title: 'Új asztal' });
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
