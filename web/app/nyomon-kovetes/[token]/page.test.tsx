import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PublicTrackingPage from './page';

const navigation = vi.hoisted(() => ({ token: 'first-link' }));
vi.mock('next/navigation', () => ({ useParams: () => navigation }));
const parcel = { id: 'job-1', title: 'Tesztcsomag', status: 'in_progress', dropoff_address: 'Szeged', delivery_code: '123456', carrier: null, last_position: null, recipient_name: 'Címzett', delivered_at: null };
const response = (status = 200, data = parcel) => ({ ok: status === 200, status, json: async () => data });
const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => { vi.useFakeTimers(); navigation.token = 'first-link'; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('503 után elérési hibát és működő újrapróbálást mutat', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response(503)).mockResolvedValueOnce(response());
  vi.stubGlobal('fetch', fetch);
  render(<PublicTrackingPage />);
  await tick();
  expect(screen.getByText('A csomagkövetés most nem elérhető')).toBeInTheDocument();
  expect(screen.queryByText('Fuvar nem található')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Újra/ }));
  await tick();
  expect(screen.getByText(parcel.title)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each([404, 410])('%s válaszra a korábban betöltött címzett és PIN is eltűnik', async status => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockResolvedValue(response(status)));
  render(<PublicTrackingPage />);
  await tick();
  expect(screen.getByText(parcel.title)).toBeInTheDocument();
  await tick(30_000);
  expect(screen.getByText('Fuvar nem található')).toBeInTheDocument();
  expect(screen.queryByText(parcel.title)).not.toBeInTheDocument();
  expect(screen.queryByText(/Átvételi PIN —/)).not.toBeInTheDocument();
});

it('frissítési hibánál megőrzi az adatokat, majd helyreáll a következő frissítésre', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response()).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(response(200, { ...parcel, title: 'Friss adat' })));
  render(<PublicTrackingPage />);
  await tick();
  await tick(30_000);
  expect(screen.getByText(parcel.title)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('utolsó sikeresen betöltött');
  expect(screen.getByText(/Utolsó frissítés:/)).toBeInTheDocument();
  await tick(30_000);
  expect(screen.getByText('Friss adat')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['headers', 'body'])('véges időkeret és megszakítás: a %s nem érkezik meg', async phase => {
  const fetch = vi.fn((_url, { signal }: RequestInit) => {
    const wait = () => new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    return phase === 'headers' ? wait() : Promise.resolve({ ok: true, status: 200, json: wait });
  });
  vi.stubGlobal('fetch', fetch);
  const view = render(<PublicTrackingPage />);
  await tick(15_000);
  expect(screen.getByRole('alert')).toHaveTextContent('nem válaszolt időben');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal!.aborted).toBe(true);
  view.unmount();
  await tick(60_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('másik tokenre váltás megszakítja a régi kérést és nem mutatja annak késői válaszát', async () => {
  let resolveOld!: (value: unknown) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(response(200, { ...parcel, title: 'Másik címzett csomagja' }));
  vi.stubGlobal('fetch', fetch);
  const view = render(<PublicTrackingPage />);
  navigation.token = 'second-link';
  view.rerender(<PublicTrackingPage />);
  await tick();
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { resolveOld(response()); });
  expect(screen.getByText('Másik címzett csomagja')).toBeInTheDocument();
  expect(screen.queryByText(parcel.title)).not.toBeInTheDocument();
});
