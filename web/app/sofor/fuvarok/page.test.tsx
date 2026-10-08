import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
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
  expect(api.listJobs).toHaveBeenLastCalledWith(expect.objectContaining({ min_price: 1000, max_price: 9000, max_weight_kg: 20, pickup_city: 'Budapest', dropoff_city: 'Szeged' }));
  // A „Típus” szűrő rejtve van (az azonnali fuvar ki van kapcsolva) — egy régi
  // mentett típus-szűrő sem szűkítheti némán a listát (UX-review Q14).
  expect(vi.mocked(api.listJobs).mock.lastCall?.[0]?.instant).toBeUndefined();
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
  fireEvent.click(screen.getByRole('button', { name: 'Szűrők' }));
  fireEvent.click(screen.getByRole('button', { name: 'Szűrés' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálom' }));
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

// ── UX-review Q14 (2026-10-08) ─────────────────────────────────────────
it('egy eszközsor: nincs „Új hirdetés feladása”, „Frissítés” és típus-szűrő', async () => {
  render(<Page />);
  await tick();
  expect(screen.queryByText('Új hirdetés feladása')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Frissítés' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Szűrők' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: /Helyem/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Szűrők' }));
  expect(screen.queryByLabelText('Típus')).toBeNull();
  expect(screen.getByText(/legfrissebb elöl/)).toBeInTheDocument();
});

it('keskeny képernyőn a „Helyem” csak ikon, de a gomb neve megmarad (fix2-review, Q13)', async () => {
  render(<Page />);
  await tick();
  const gomb = screen.getByRole('button', { name: 'Helyem' });
  const felirat = gomb.querySelector('.eszkozsor-felirat');
  expect(felirat?.textContent).toBe('Helyem');
  // A CSS vizuálisan rejti (nem display:none — az a nevet is elvenné), és
  // csak keskeny képernyőn: 390 px-en a gomb eddig a második sorba tört.
  const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'globals.css'), 'utf8');
  const blokk = /@media \(max-width: (\d+)px\) \{\s*\.eszkozsor-felirat \{([^}]*)\}/.exec(css);
  expect(blokk, 'nincs keskeny-képernyős szabály az .eszkozsor-felirat-ra').toBeTruthy();
  expect(Number(blokk![1])).toBeGreaterThanOrEqual(390);
  expect(blokk![2]).toMatch(/clip: rect\(0 0 0 0\)/);
  expect(blokk![2]).not.toMatch(/display:\s*none/);
});

it('új fuvar a háttérben: „1 új fuvar – mutasd” pirula, a lista nem ugrik el', async () => {
  vi.mocked(api.listJobs).mockResolvedValueOnce([job('Régi')]).mockResolvedValue([job('Friss'), job('Régi')]);
  render(<Page />);
  await tick();
  act(() => { mocks.feed['jobs:new'](job('Friss')); });
  await tick(250);
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Régi']);
  fireEvent.click(screen.getByRole('button', { name: /1 új fuvar – mutasd/ }));
  expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Friss', 'Régi']);
  expect(screen.queryByRole('button', { name: /új fuvar – mutasd/ })).toBeNull();
});

it('szűrt, üres találat: a szűrőkről szól, törölhető, és a figyelő előtöltve nyílik', async () => {
  mentPiszkozat('gofuvar_fuvarok_szurok', { min: '', max: '', weight: '', from: 'Budapest', to: 'Szeged', type: '' });
  render(<Page />);
  await tick();
  expect(screen.getByText('A szűrőidnek most egy fuvar sem felel meg')).toBeInTheDocument();
  expect(screen.queryByText('Most épp nincs elérhető fuvar')).toBeNull();
  expect(screen.getByRole('link', { name: 'Értesíts, ha jön ilyen' }))
    .toHaveAttribute('href', '/sofor/ertesitok?honnan=Budapest&hova=Szeged');
  const torles = screen.getAllByRole('button', { name: 'Szűrők törlése' });
  fireEvent.click(torles[torles.length - 1]);
  await tick();
  expect(vi.mocked(api.listJobs).mock.lastCall?.[0]?.pickup_city).toBeUndefined();
  expect(screen.getByText('Most épp nincs elérhető fuvar')).toBeInTheDocument();
});

it('a díj előtti címnél lakat jelzi, hogy a házszám a díj után jön', async () => {
  vi.mocked(api.listJobs).mockResolvedValue([job('Kanapé')]);
  render(<Page />);
  await tick();
  expect(screen.getAllByText('(házszám a díj után)').length).toBe(2);
});
