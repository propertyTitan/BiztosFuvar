import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import KycModal from './KycModal';
import { api } from '@/api';

vi.mock('@/api', () => ({ api: { uploadKycDocument: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

function openModal() {
  render(<KycModal />);
  act(() => { window.dispatchEvent(new CustomEvent('gofuvar:kyc-required', { detail: { code: 'IDENTITY_KYC_REQUIRED' } })); });
  return document.getElementById('kyc-dokumentum') as HTMLInputElement;
}

it.each(['application/pdf', 'image/svg+xml', 'image/bmp'])('a %s fájlt kiválasztáskor elutasítja, feltöltés előtt', (type) => {
  const input = openModal();
  fireEvent.change(input, { target: { files: [new File(['document'], 'okmany', { type })] } });
  expect(screen.getByRole('alert')).toHaveTextContent('Képfájlt válassz');
  expect(screen.getByRole('button', { name: 'Dokumentum feltöltése' })).toBeDisabled();
  expect(api.uploadKycDocument).not.toHaveBeenCalled();
  expect(input.accept).not.toContain('.pdf');
});

it('túl nagy kép helyett érvényes képet választva törli a hibát és feltölt', async () => {
  const input = openModal();
  const large = new File(['a'], 'nagy.jpg', { type: 'image/jpeg' });
  Object.defineProperty(large, 'size', { value: 15 * 1024 * 1024 + 1 });
  fireEvent.change(input, { target: { files: [large] } });
  expect(screen.getByRole('alert')).toHaveTextContent('legfeljebb 15 MB');
  const photo = new File(['photo'], 'igazolvany.jpg', { type: 'image/jpeg' });
  vi.mocked(api.uploadKycDocument).mockResolvedValue({ ok: true, status: 'pending', doc_type: 'id_card', file_url: '' });
  fireEvent.change(input, { target: { files: [photo] } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dokumentum feltöltése' }));
  await waitFor(() => expect(api.uploadKycDocument).toHaveBeenCalledWith(photo, 'id_card'));
  expect(api.uploadKycDocument).toHaveBeenCalledTimes(1);
});
