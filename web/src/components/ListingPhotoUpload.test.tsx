import { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ListingPhotoUpload from './ListingPhotoUpload';
import { api } from '@/api';

vi.mock('@/api', () => ({ api: { uploadJobPhoto: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

it('részleges hiba után csak a hibás fotót ismétli, ugyanahhoz a fuvarhoz', async () => {
  const first = new File(['a'], 'elso.jpg', { type: 'image/jpeg' });
  const second = new File(['b'], 'masodik.jpg', { type: 'image/jpeg' });
  vi.mocked(api.uploadJobPhoto).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Tárolási hiba')).mockResolvedValueOnce({});
  const next = vi.fn();
  render(<StrictMode><ListingPhotoUpload jobId="job-1" photos={[first, second]} onContinue={next} /></StrictMode>);
  expect(await screen.findByRole('alert')).toHaveTextContent('masodik.jpg: Tárolási hiba');
  expect(screen.getByRole('status')).toHaveTextContent('1 / 2 fotó feltöltve');
  expect(next).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sikertelen fotók újrapróbálása' }));
  await waitFor(() => expect(next).toHaveBeenCalledWith(2));
  expect(api.uploadJobPhoto).toHaveBeenCalledTimes(3);
  expect(api.uploadJobPhoto).toHaveBeenNthCalledWith(3, 'job-1', second, 'listing');
});

it('minden kép hibája esetén nulla feltöltéssel enged továbblépni', async () => {
  vi.mocked(api.uploadJobPhoto).mockRejectedValue(new Error('Nincs kapcsolat'));
  const next = vi.fn();
  render(<ListingPhotoUpload jobId="job-2" photos={[new File(['a'], 'a.jpg')]} onContinue={next} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Tovább a fuvarhoz' }));
  expect(next).toHaveBeenCalledWith(0);
});

it('fotó nélkül egyszer lép tovább, feltöltési kérés nélkül', async () => {
  const next = vi.fn();
  render(<StrictMode><ListingPhotoUpload jobId="job-3" photos={[]} onContinue={next} /></StrictMode>);
  await waitFor(() => expect(next).toHaveBeenCalledWith(0));
  expect(next).toHaveBeenCalledTimes(1);
  expect(api.uploadJobPhoto).not.toHaveBeenCalled();
});
