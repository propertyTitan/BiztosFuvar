import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import HozasdElTool from './HozasdElTool';
import { api } from '@/api';
import { HOZASD_EL_PREFILL, readHozasdEl } from '@/lib/hozasdEl';

const mocks = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => null }));
vi.mock('@/components/AddressAutocomplete', () => ({ default: () => null }));
vi.mock('@/api', () => ({ api: { linkPreview: vi.fn() } }));
const url = 'https://www.ikea.com/hu/hu/p/billy/';
beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); sessionStorage.clear(); });

it('a vendég szerkeszthető előnézetet kap, majd megőrzi az adatokat és regisztrációhoz irányít', async () => {
  vi.mocked(api.linkPreview).mockResolvedValue({ ok: true, url, source: 'IKEA', title: 'BILLY', image: null, description: null });
  render(<HozasdElTool />);
  fireEvent.change(screen.getByLabelText('Hirdetés vagy termék linkje'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Előnézet' }));
  await waitFor(() => expect(screen.getByLabelText('A szállítandó tárgy')).toHaveValue('BILLY'));
  fireEvent.change(screen.getByLabelText('A szállítandó tárgy'), { target: { value: 'Két BILLY polc' } });
  fireEvent.click(screen.getByRole('button', { name: /Folytatom a feladást/ }));
  expect(readHozasdEl(HOZASD_EL_PREFILL, null)?.title).toBe('Két BILLY polc');
  expect(mocks.router.push).toHaveBeenCalledWith('/bejelentkezes?mode=register&next=%2Fdashboard%2Fuj-fuvar');
});

it('a későn érkező előnézet nem írja felül a kézzel megadott tárgyat', async () => {
  let resolve!: (value: any) => void;
  vi.mocked(api.linkPreview).mockReturnValue(new Promise(r => { resolve = r; }));
  render(<HozasdElTool furniture />);
  fireEvent.change(screen.getByLabelText('Hirdetés vagy termék linkje'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Előnézet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Link nélkül adom meg' }));
  fireEvent.change(screen.getByLabelText('A szállítandó tárgy'), { target: { value: 'Kanapé' } });
  await act(async () => { resolve({ ok: true, url, source: 'IKEA', title: 'BILLY' }); });
  expect(screen.getByLabelText('A szállítandó tárgy')).toHaveValue('Kanapé');
  fireEvent.click(screen.getByRole('button', { name: /Folytatom a feladást/ }));
  expect(readHozasdEl(HOZASD_EL_PREFILL, null)).toMatchObject({ title: 'Kanapé', url: '', sourceName: '', image: '' });
});

it('sikertelen link után kézi megadással folytatható, tárolási hiba esetén nem navigál el', async () => {
  vi.mocked(api.linkPreview).mockRejectedValue(new Error('Nem támogatott link'));
  render(<HozasdElTool />);
  fireEvent.change(screen.getByLabelText('Hirdetés vagy termék linkje'), { target: { value: 'https://facebook.com/marketplace/item/123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Előnézet' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('add meg a tárgyat link nélkül');
  fireEvent.click(screen.getByRole('button', { name: 'Link nélkül adom meg' }));
  fireEvent.change(screen.getByLabelText('A szállítandó tárgy'), { target: { value: 'Kanapé' } });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  fireEvent.click(screen.getByRole('button', { name: /Folytatom a feladást/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('A böngésző nem tudta megőrizni');
  expect(screen.getByLabelText('A szállítandó tárgy')).toHaveValue('Kanapé');
  expect(mocks.router.push).not.toHaveBeenCalled();
});
