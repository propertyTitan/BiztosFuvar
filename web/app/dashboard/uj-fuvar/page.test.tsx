import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';
import { api } from '@/api';
import { mentPiszkozat, piszkozatKulcs, UJ_FUVAR_PISZKOZAT_ELOTAG } from '@/lib/urlapPiszkozat';
import { StrictMode } from 'react';
import { emptyHozasdElDraft, HOZASD_EL_PREFILL, readHozasdEl, saveHozasdEl } from '@/lib/hozasdEl';

const mocks = vi.hoisted(() => ({
  user: { id: 'sender-1' }, router: { push: vi.fn() },
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@/components/AddressAutocomplete', () => ({ default: () => null }));
vi.mock('@/api', () => ({ api: { createJob: vi.fn(), uploadJobPhoto: vi.fn(), priceEstimate: vi.fn() } }));
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(api.priceEstimate).mockRejectedValue(new Error('Az árbecslés nem érhető el.'));
});

const key = piszkozatKulcs(UJ_FUVAR_PISZKOZAT_ELOTAG, mocks.user.id);
const image = 'https://www.ikea.com/hu/hu/images/billy.jpg';
function incomingProduct() {
  saveHozasdEl(HOZASD_EL_PREFILL, { ...emptyHozasdElDraft(), title: 'BILLY polc', ready: true, kind: 'furniture',
    url: 'https://www.ikea.com/hu/hu/p/billy/', sourceName: 'IKEA', image,
    pickup: { address: 'Budapest, Váci út 1.', lat: 47.5, lng: 19, confirmed: true },
    dropoff: { address: 'Szeged, Kossuth Lajos sugárút 1.', lat: 46.25, lng: 20.1, confirmed: true },
  }, null);
}

it('az előtöltést StrictMode alatt egyszer veszi át, kép és cím újratöltés után is eljut a feladásba', async () => {
  incomingProduct();
  const first = render(<StrictMode><Page /></StrictMode>);
  expect(screen.getByLabelText(/Megnevezés/)).toHaveValue('BILLY polc');
  expect(sessionStorage.getItem(HOZASD_EL_PREFILL)).toBeNull();
  first.unmount();
  render(<Page />);
  expect(screen.getByLabelText(/Megnevezés/)).toHaveValue('BILLY polc');
  expect(screen.getByRole('region', { name: 'Ezzel a tárggyal folytatod' })).toHaveTextContent('BILLY polc');
  expect(screen.getByAltText('A hirdetésből átvett termékkép')).toHaveAttribute('src', image);
  expect(screen.getByText('Mit egyeztessek az eladóval a bútorról?')).toBeVisible();
  expect(screen.getByLabelText(/Hosszúság \(cm\)/)).toHaveValue('');
  expect(screen.getByLabelText(/Súly \(kg\)/)).toHaveValue('');
  const guideLinks = screen.getByRole('navigation', { name: 'A fuvarfeladás kitöltendő részei' }).querySelectorAll('a');
  for (const link of guideLinks) expect(document.querySelector(link.getAttribute('href')!)).not.toBeNull();
  expect(screen.getByRole('link', { name: /Méret és súly/ })).toHaveAttribute('aria-current', 'step');
  for (const [placeholder, value] of [['pl. 120', '80'], ['pl. 80', '28'], ['pl. 100', '202'], ['pl. 350', '30']]) {
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
  }
  fireEvent.change(screen.getByPlaceholderText(/65000/), { target: { value: '12000' } });
  expect(screen.getAllByText('Megadva')).toHaveLength(3);
  expect(screen.queryByText('Kitöltendő')).not.toBeInTheDocument();
  vi.mocked(api.createJob).mockResolvedValue({ id: 'new-product' } as any);
  fireEvent.click(screen.getByRole('button', { name: /Fuvar feladása/ }));
  await waitFor(() => expect(api.createJob).toHaveBeenCalledWith(expect.objectContaining({
    title: 'BILLY polc', source_store: 'IKEA', source_image_url: image,
    pickup_address: 'Budapest, Váci út 1.', pickup_lat: 47.5, dropoff_lat: 46.25,
  })));
});

it.each(['new', 'previous'])('korábbi piszkozat mellett választást kér, az adatok nem keverednek: %s', async choice => {
  mentPiszkozat(key, { form: { title: 'Régi dobozok', description: 'Régi leírás', recipient_name: 'Régi címzett' } });
  const previous = localStorage.getItem(key);
  incomingProduct();
  render(<Page />);
  expect(screen.getByRole('heading', { name: 'Melyik feladással folytatod?' })).toBeVisible();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  expect(localStorage.getItem(key)).toBe(previous);
  fireEvent.click(screen.getByRole('button', { name: choice === 'new' ? 'Az új tárgy feladását kezdem' : 'A korábbi piszkozattal folytatom' }));
  expect(screen.getByLabelText(/Megnevezés/)).toHaveValue(choice === 'new' ? 'BILLY polc' : 'Régi dobozok');
  expect(screen.getByLabelText('Részletes leírás')).toHaveValue(choice === 'new' ? 'Forrás (IKEA): https://www.ikea.com/hu/hu/p/billy/' : 'Régi leírás');
  expect(sessionStorage.getItem(HOZASD_EL_PREFILL)).toBeNull();
  if (choice === 'new') expect(localStorage.getItem(key)).not.toContain('Régi címzett');
  else expect(screen.queryByRole('region', { name: 'Ezzel a tárggyal folytatod' })).not.toBeInTheDocument();
});

it('sikertelen piszkozatmentésnél az átadott termék nem vész el', () => {
  incomingProduct();
  const originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
    if (this === localStorage) throw new Error('Storage blocked');
    originalSet.call(this, k, v);
  });
  render(<Page />);
  expect(screen.getByRole('alert')).toHaveTextContent('nem sikerült a fuvarpiszkozatba menteni');
  expect(readHozasdEl(HOZASD_EL_PREFILL, mocks.user.id)?.title).toBe('BILLY polc');
  vi.restoreAllMocks();
  fireEvent.click(screen.getByRole('button', { name: 'Az új tárgy feladását kezdem' }));
  expect(screen.getByLabelText(/Megnevezés/)).toHaveValue('BILLY polc');
});

it('fotóhiba és újrapróbálás után is egyetlen fuvar jön létre, a piszkozat nem éled újra', async () => {
  const key = piszkozatKulcs(UJ_FUVAR_PISZKOZAT_ELOTAG, mocks.user.id);
  mentPiszkozat(key, { form: {
    title: 'Dobozok', pickup_address: 'Budapest 1.', pickup_lat: 47.5, pickup_lng: 19,
    pickup_confirmed: true, dropoff_address: 'Szeged 1.', dropoff_lat: 46.25,
    dropoff_lng: 20.1, dropoff_confirmed: true, length_cm: 30, width_cm: 30,
    height_cm: 30, weight_kg: 5, suggested_price_huf: 5000,
  } });
  vi.mocked(api.createJob).mockResolvedValue({ id: 'created-1' } as any);
  vi.mocked(api.uploadJobPhoto).mockRejectedValueOnce(new Error('Fotóhiba')).mockResolvedValueOnce({});
  const { container } = render(<Page />);
  const file = new File(['photo'], 'doboz.jpg', { type: 'image/jpeg' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: /Fuvar feladása/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Fotóhiba');
  expect(mocks.router.push).not.toHaveBeenCalled();
  expect(mocks.toast.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sikertelen fotók újrapróbálása' }));
  await waitFor(() => expect(mocks.router.push).toHaveBeenCalledWith('/dashboard/fuvar/created-1'));
  expect(api.createJob).toHaveBeenCalledTimes(1);
  expect(api.uploadJobPhoto).toHaveBeenNthCalledWith(2, 'created-1', file, 'listing');
  expect(mocks.toast.success).toHaveBeenCalledWith('Fuvar feladva', '1 feltöltött fotóval');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  expect(localStorage.getItem(key)).toBeNull();
});
