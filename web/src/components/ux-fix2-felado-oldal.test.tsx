// =====================================================================
//  UX-átvizsgálás, 2. javítókör (fix2-review) — a feladói fuvaroldal
//
//  - elfogadás után a díjkártya TETEJÉRE görgetünk (a díj és a kiválasztott
//    szállító), nem a kártyán belüli fizetési blokkra (az a nyilatkozattal
//    kezdődik, és a 32 px-es díj a nézet fölé csúszott);
//  - díjmentes újranyitás után (bidding + paid_at, accepted_price_huf NULL)
//    nincs „Fuvardíj: 0 Ft" sor;
//  - lemondott, fizetett fuvarnál az „ajánlói jutalmad fedezte" csak a
//    ténylegesen 0 Ft-os díjra jár — a régi, díj nélküli (NULL) sorra nem;
//  - az elmúlt vállalt felvételi időpont nem „Várható felvétel";
//  - a bizonyíték-fotók rácsban, rövid dátummal.
// =====================================================================
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShipperPage from '../../app/dashboard/fuvar/[id]/page';
import { api } from '@/api';

const mocks = vi.hoisted(() => ({
  user: { id: 'shipper', role: 'shipper' },
  socket: { on: vi.fn(), off: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job' }), useRouter: () => ({ push: mocks.push, refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user }));
vi.mock('@/api', () => ({
  api: { getJob: vi.fn(), listBids: vi.fn(), listPhotos: vi.fn(), acceptBid: vi.fn() },
  photoUrl: (url: string) => url,
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => mocks.socket, joinUserRoom: vi.fn(), subscribeJob: vi.fn(() => vi.fn()) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@/components/LiveTrackingMap', () => ({ default: () => null }));
vi.mock('@/components/JobQuestions', () => ({ default: () => null }));
vi.mock('@/components/ReviewBox', () => ({ default: () => null }));
vi.mock('@/components/ChatBox', () => ({ default: () => null }));
vi.mock('@/components/Confetti', () => ({ default: () => null }));
vi.mock('@/components/TesztFizetesSav', () => ({ default: () => null }));
vi.mock('@/components/DijFizetesKartya', () => ({ default: () => <div id="dij-fizetes">díjkártya-mock</div> }));

const ALAP = {
  id: 'job', shipper_id: 'shipper', carrier_id: 'carrier', title: 'Íróasztal Pécsre',
  pickup_address: 'Budapest, Margit körút 50.', dropoff_address: 'Pécs, Király utca 15.',
  pickup_lat: 47.51, pickup_lng: 19.04, dropoff_lat: 46.07, dropoff_lng: 18.23,
  accepted_price_huf: 24000, connection_fee_huf: 500, weight_kg: 55,
  recipient_name: null, recipient_phone: null,
};

const eredetiScroll = Element.prototype.scrollIntoView;
const gorgetett: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  gorgetett.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { gorgetett.push(this.id); });
  window.localStorage.clear();
  vi.mocked(api.listBids).mockResolvedValue([]);
  vi.mocked(api.listPhotos).mockResolvedValue([]);
});
afterEach(() => {
  Element.prototype.scrollIntoView = eredetiScroll;
  vi.useRealTimers();
});

describe('elfogadás után a díjkártya tetejére görgetünk', () => {
  it('a #kapcsolatfelveteli-dij kártyára, nem a fizetési blokkra (#dij-fizetes)', async () => {
    const ajanlat = {
      id: 'b1', job_id: 'job', carrier_id: 'c1', carrier_name: 'Szabó Péter', status: 'pending',
      revision: 1, amount_huf: 24000, rating_count: 0,
    };
    vi.mocked(api.getJob).mockResolvedValueOnce({ ...ALAP, status: 'bidding', carrier_id: null, paid_at: null } as any);
    vi.mocked(api.listBids).mockResolvedValueOnce([ajanlat] as any);
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'accepted', carrier_id: 'c1', paid_at: null } as any);
    vi.mocked(api.listBids).mockResolvedValue([{ ...ajanlat, status: 'accepted' }] as any);
    vi.mocked(api.acceptBid).mockResolvedValue({} as any);

    render(<ShipperPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Elfogadom' }));
    await waitFor(() => expect(gorgetett.length).toBeGreaterThan(0));
    expect(gorgetett).toContain('kapcsolatfelveteli-dij');
    expect(gorgetett).not.toContain('dij-fizetes');
    const kartya = screen.getByTestId('kapcsolatfelveteli-dij-kartya');
    expect(kartya.id).toBe('kapcsolatfelveteli-dij');
  });
});

describe('a díjkártya fuvardíj-sora csak megállapodott árnál', () => {
  it('díjmentes újranyitás után (bidding + paid_at, ár nélkül) nincs „Fuvardíj: 0 Ft"', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'bidding', carrier_id: null, accepted_price_huf: null,
      paid_at: '2026-10-08T07:00:00Z', reopened_count: 1,
    } as any);
    render(<ShipperPage />);
    const kartya = await screen.findByTestId('kapcsolatfelveteli-dij-kartya');
    expect(kartya.textContent).not.toMatch(/Fuvardíj:/);
    expect(kartya.textContent).not.toMatch(/0 Ft —/);
  });

  it('elfogadott árnál a fuvardíj-sor megjelenik', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'accepted', paid_at: null } as any);
    render(<ShipperPage />);
    const kartya = await screen.findByTestId('kapcsolatfelveteli-dij-kartya');
    expect(kartya.textContent).toMatch(/Fuvardíj: 24\s000 Ft — közvetlenül a szállítónak/);
  });
});

describe('lemondott, fizetett fuvar: a díj sorsa a valós díj szerint', () => {
  it('NULL díj (régi sor): az általános „nem jár vissza" mondat, nem az ajánlói jutalom', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'cancelled', paid_at: '2026-10-08T07:00:00Z', cancelled_at: '2026-10-08T08:00:00Z',
      connection_fee_huf: null,
    } as any);
    render(<ShipperPage />);
    const kartya = await screen.findByTestId('kapcsolatfelveteli-dij-kartya');
    expect(kartya.textContent).not.toMatch(/ajánlói jutalmad/);
    expect(kartya.textContent).toMatch(/nem jár vissza/);
  });

  it('0 Ft-os (kuponos) díj: az ajánlói jutalom fedezte', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'cancelled', paid_at: '2026-10-08T07:00:00Z', cancelled_at: '2026-10-08T08:00:00Z',
      connection_fee_huf: 0,
    } as any);
    render(<ShipperPage />);
    const kartya = await screen.findByTestId('kapcsolatfelveteli-dij-kartya');
    expect(kartya.textContent).toMatch(/ajánlói jutalmad fedezte/);
  });
});

describe('az elmúlt vállalt felvételi időpont nem „Várható"', () => {
  it('napokkal korábbi ajánlatnál átfogalmazva, kérdezésre biztat', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'bidding', carrier_id: null, paid_at: null } as any);
    vi.mocked(api.listBids).mockResolvedValue([
      { id: 'b1', job_id: 'job', carrier_id: 'c1', carrier_name: 'Szabó Péter', status: 'pending', revision: 1,
        amount_huf: 23000, eta_minutes: 300, created_at: '2026-10-05T08:40:00Z' },
    ] as any);
    render(<ShipperPage />);
    expect(await screen.findByText(/A vállalt felvételi időpont \(kb\. okt\. 5\., 15:40\) elmúlt/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Várható felvétel/);
  });
});

describe('bizonyíték-fotók', () => {
  it('rácsban, rövid dátummal (nem másodpercre pontos toLocaleString)', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'in_progress', paid_at: '2026-10-08T07:00:00Z' } as any);
    vi.mocked(api.listPhotos).mockResolvedValue([
      { id: 'p1', kind: 'pickup', url: '/u/p1.jpg', taken_at: '2026-10-08T08:52:30Z' },
      { id: 'p2', kind: 'dropoff', url: '/u/p2.jpg', taken_at: '2026-10-08T10:15:00Z' },
    ] as any);
    render(<ShipperPage />);
    const racs = await screen.findByTestId('bizonyitek-foto-racs');
    expect(racs.style.display).toBe('grid');
    expect(within(racs).getAllByRole('img')).toHaveLength(2);
    expect(racs.textContent).toMatch(/okt\. 8\., 10:52/);
    expect(racs.textContent).not.toMatch(/10:52:30/);
  });
});
