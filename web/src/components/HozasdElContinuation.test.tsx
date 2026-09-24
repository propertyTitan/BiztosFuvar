import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HozasdElLoginHint, HozasdElVerifiedContinue } from './HozasdElContinuation';
import { emptyHozasdElDraft, HOZASD_EL_PREFILL, saveHozasdEl } from '@/lib/hozasdEl';
import { mentPiszkozat, piszkozatKulcs, UJ_FUVAR_PISZKOZAT_ELOTAG } from '@/lib/urlapPiszkozat';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => auth.user }));
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); auth.user = null; });

it('a belépésnél megerősíti a vendég megkezdett feladását', () => {
  saveHozasdEl(HOZASD_EL_PREFILL, { ...emptyHozasdElDraft(), title: 'Kanapé', ready: true }, null);
  render(<HozasdElLoginHint />);
  expect(screen.getByRole('complementary')).toHaveTextContent('A feladásod megmaradt: Kanapé');
  expect(sessionStorage.getItem(HOZASD_EL_PREFILL)).not.toBeNull();
});

it('email-megerősítés után saját helyi piszkozatot folytat, fiókváltásnál nem mutat idegen adatot', () => {
  auth.user = { id: 'sender-1' };
  mentPiszkozat(piszkozatKulcs(UJ_FUVAR_PISZKOZAT_ELOTAG, auth.user.id), {
    form: { title: 'Saját kanapé' }, hozasdElKind: 'furniture',
  });
  const view = render(<HozasdElVerifiedContinue />);
  expect(screen.getByRole('link', { name: /Folytatom a fuvarfeladást/ })).toHaveAttribute('href', '/dashboard/uj-fuvar');
  auth.user = { id: 'sender-2' };
  view.rerender(<HozasdElVerifiedContinue />);
  expect(screen.queryByText('Saját kanapé')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Tovább az oldalra/ })).toHaveAttribute('href', '/');
});

it('piszkozat nélkül nem mutat megtévesztő folytatási ígéretet', () => {
  render(<><HozasdElLoginHint /><HozasdElVerifiedContinue /></>);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/');
});
