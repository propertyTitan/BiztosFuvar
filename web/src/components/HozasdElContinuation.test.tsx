import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HozasdElLoginHint, HozasdElVerifiedContinue } from './HozasdElContinuation';
import { emptyHozasdElDraft, HOZASD_EL_PREFILL, saveHozasdEl } from '@/lib/hozasdEl';
import { mentPiszkozat, piszkozatKulcs, UJ_FUVAR_PISZKOZAT_ELOTAG } from '@/lib/urlapPiszkozat';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
const navigate = vi.fn();
const loginUrl = '/bejelentkezes?mode=login&email_verified=1';
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => auth.user }));
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); auth.user = null; navigate.mockClear();
  vi.stubGlobal('window', new Proxy(window, {
    get(target, key) {
      return key === 'location' ? { replace: navigate } : Reflect.get(target, key, target);
    },
  }));
});
afterEach(() => vi.unstubAllGlobals());

it('a belépésnél megerősíti a vendég megkezdett feladását', () => {
  saveHozasdEl(HOZASD_EL_PREFILL, { ...emptyHozasdElDraft(), title: 'Kanapé', ready: true }, null);
  render(<HozasdElLoginHint />);
  expect(screen.getByRole('complementary')).toHaveTextContent('A feladásod megmaradt: Kanapé');
  expect(sessionStorage.getItem(HOZASD_EL_PREFILL)).not.toBeNull();
});

it('email-megerősítés után belépésre visz a saját piszkozat folytatásával, fiókváltásnál nem mutat idegen adatot', () => {
  auth.user = { id: 'sender-1' };
  mentPiszkozat(piszkozatKulcs(UJ_FUVAR_PISZKOZAT_ELOTAG, auth.user.id), {
    form: { title: 'Saját kanapé' }, hozasdElKind: 'furniture',
  });
  const view = render(<HozasdElVerifiedContinue />);
  expect(screen.getByRole('link', { name: /Tovább a bejelentkezéshez/ })).toHaveAttribute('href', `${loginUrl}&next=%2Fdashboard%2Fuj-fuvar`);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith(`${loginUrl}&next=%2Fdashboard%2Fuj-fuvar`);
  auth.user = { id: 'sender-2' };
  view.rerender(<HozasdElVerifiedContinue />);
  expect(screen.queryByText('Saját kanapé')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Tovább a bejelentkezéshez/ })).toHaveAttribute('href', loginUrl);
  expect(navigate).toHaveBeenLastCalledWith(loginUrl);
});

it('piszkozat nélkül nem mutat megtévesztő folytatási ígéretet', () => {
  render(<><HozasdElLoginHint /><HozasdElVerifiedContinue /></>);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', loginUrl);
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(navigate).toHaveBeenCalledWith(loginUrl);
});
