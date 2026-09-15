import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import Page from './page';
import { api, type Job } from '@/api';
import { mentPiszkozat } from '@/lib/urlapPiszkozat';

const mocks = vi.hoisted(() => ({ feed: {} as Record<string, (payload?: any) => void>, unsubscribe: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/api', () => ({ api: { listJobs: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => null }));
vi.mock('@/lib/socket', () => ({ subscribeFeed: (handlers: typeof mocks.feed) => { mocks.feed = handlers; return mocks.unsubscribe; } }));
vi.mock('@/components/JobBrowseMap', () => ({ default: () => null }));
vi.mock('@/components/GreenBadge', () => ({ default: () => null }));
vi.mock('@/lib/i18n', () => ({ useTranslation: () => ({ t: (s: string) => s }), formatPrice: (n: number) => String(n) }));

const job = (id: string) => ({ id, title: id, pickup_address: 'Budapest', dropoff_address: 'Szeged' }) as Job;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  localStorage.clear();
  vi.mocked(api.listJobs).mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'permissions');
  Reflect.deleteProperty(navigator, 'geolocation');
});
async function tick(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it('a feed az alkalmazott szűrőkkel kérdez, nem illeszti be a szűrés nélküli payloadot', async () => {
  mentPiszkozat('gofuvar_fuvarok_szurok', { min: '1000', max: '9000', weight: '20', from: 'Budapest', to: 'Szeged', type: 'false' });
  vi.mocked(api.listJobs).mockResolvedValue([job('Közeli'), job('Távolabbi')]);
  render(<Page />);
  await tick();
  fireEvent.change(screen.getByLabelText('Max ár (Ft)'), { target: { value: '3000' } });
  act(() => { mocks.feed['jobs:new'](job('Nem megfelelő')); mocks.feed['jobs:new'](job('Másik')); });
  await tick(250);
  expect(api.listJobs).toHaveBeenCalledTimes(2);
  expect(api.listJobs).toHaveBeenLastCalledWith(expect.objectContaining({ min_price: 1000, max_price: 9000, max_weight_kg: 20, pickup_city: 'Budapest', dropoff_city: 'Szeged', instant: 'false' }));
  expect(screen.queryByText('Nem megfelelő')).toBeNull();
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Közeli', 'Távolabbi']);
  fireEvent.click(screen.getByRole('button', { name: 'Szűrés' }));
  await tick();
  expect(api.listJobs).toHaveBeenLastCalledWith(expect.objectContaining({ max_price: 3000 }));
});

it('a későn érkező korábbi válasz nem írhatja felül az új keresést', async () => {
  let oldResponse!: (jobs: Job[]) => void;
  vi.mocked(api.listJobs).mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; }))
    .mockResolvedValueOnce([job('Friss')]);
  render(<Page />);
  fireEvent.click(screen.getByRole('button', { name: 'Frissítés' }));
  await tick();
  await act(async () => { oldResponse([job('Régi')]); });
  expect(screen.getByText('Friss')).toBeInTheDocument();
  expect(screen.queryByText('Régi')).toBeNull();
});

it('sikeres újrapróbálás törli a korábbi hibaüzenetet', async () => {
  vi.mocked(api.listJobs).mockRejectedValueOnce(new Error('Teszt kapcsolat hiba')).mockResolvedValueOnce([job('Friss')]);
  render(<Page />);
  await tick();
  expect(screen.getByText(/Teszt kapcsolat hiba/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Frissítés' }));
  await tick();
  expect(screen.queryByText(/Teszt kapcsolat hiba/)).toBeNull();
  expect(screen.getByText('Friss')).toBeInTheDocument();
});

it('leváláskor törli a várakozó feed-frissítést', async () => {
  const { unmount } = render(<Page />);
  await tick();
  act(() => { mocks.feed['jobs:new'](job('Új')); });
  unmount();
  await tick(250);
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  expect(api.listJobs).toHaveBeenCalledTimes(1);
});

it('a GPS késői válasza és a feed megtartja a mentett szűrést és a helyadatot', async () => {
  mentPiszkozat('gofuvar_fuvarok_szurok', { ...{ min: '', weight: '', from: '', to: '', type: '' }, max: '6000' });
  let locate!: PositionCallback;
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn().mockResolvedValue({ state: 'granted' }) } });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn((callback) => { locate = callback; }) } });
  const { unmount } = render(<Page />);
  await tick();
  act(() => locate({ coords: { latitude: 47.5, longitude: 19.1 } } as GeolocationPosition));
  await tick();
  expect(api.listJobs).toHaveBeenLastCalledWith(expect.objectContaining({ max_price: 6000, lat: 47.5, lng: 19.1, radius_km: 500 }));
  act(() => { mocks.feed['jobs:new'](job('Új')); });
  await tick(250);
  expect(api.listJobs).toHaveBeenLastCalledWith(expect.objectContaining({ max_price: 6000, lat: 47.5, lng: 19.1 }));
  unmount();
  Reflect.deleteProperty(navigator, 'permissions');
  Reflect.deleteProperty(navigator, 'geolocation');
});

it('az elvállalt fuvart egy folyamatban lévő régi válasz sem hozza vissza', async () => {
  let oldResponse!: (jobs: Job[]) => void;
  vi.mocked(api.listJobs).mockImplementationOnce(() => new Promise(resolve => { oldResponse = resolve; })).mockResolvedValueOnce([]);
  render(<Page />);
  act(() => mocks.feed['jobs:instant-taken']({ job_id: 'Elvállalt' }));
  await act(async () => oldResponse([job('Elvállalt')]));
  expect(screen.queryByText('Elvállalt')).toBeNull();
  await tick(250);
  expect(api.listJobs).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('Elvállalt')).toBeNull();
});
