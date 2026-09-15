import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import Page from './page';
import { api } from '@/api';
import { mentPiszkozat, piszkozatKulcs, UJ_FUVAR_PISZKOZAT_ELOTAG } from '@/lib/urlapPiszkozat';

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
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  vi.mocked(api.priceEstimate).mockRejectedValue(new Error('Az árbecslés nem érhető el.'));
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
