// =====================================================================
//  UX-átvizsgálás (2026-10-08) — a feladói fuvaroldal megjelenítési őrei
//
//  A1  címzett nélküli kézbesítésen NINCS hamis „vészhelyzeti kóddal zárult"
//  A2  a kódkártya: a címzett a felvételkor kapja az SMS-t; „csak átadáskor"
//  A12 az állapot-jelvény a díj állapotát mondja
//  A21 lemondott fuvar: nincs díjfizetésre biztatás, van „Újra feladom"
//  Q6  az ajánlat-lista fejléce: bizalmi sor + a díj egyszer
//  Q8  a díj a kártya fő eleme, megnevezi a kiválasztott szállítót
//  Q18 a chat a díj előtt előre jelzi a kontakt-szabályt
// =====================================================================
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ShipperPage from '../../app/dashboard/fuvar/[id]/page';
import { api } from '@/api';

const mocks = vi.hoisted(() => ({
  user: { id: 'shipper', role: 'shipper' },
  socket: { on: vi.fn(), off: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  push: vi.fn(),
  chatProps: [] as any[],
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job' }), useRouter: () => ({ push: mocks.push, refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user }));
vi.mock('@/api', () => ({ api: { getJob: vi.fn(), listBids: vi.fn(), listPhotos: vi.fn() }, photoUrl: (url: string) => url }));
vi.mock('@/lib/socket', () => ({ getSocket: () => mocks.socket, joinUserRoom: vi.fn(), subscribeJob: vi.fn(() => vi.fn()) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@/components/LiveTrackingMap', () => ({ default: () => null }));
vi.mock('@/components/JobQuestions', () => ({ default: () => null }));
vi.mock('@/components/ReviewBox', () => ({ default: () => null }));
vi.mock('@/components/ChatBox', () => ({ default: (p: any) => { mocks.chatProps.push(p); return null; } }));
vi.mock('@/components/Confetti', () => ({ default: () => null }));
vi.mock('@/components/TesztFizetesSav', () => ({ default: () => null }));
vi.mock('@/components/DijFizetesKartya', () => ({ default: () => <div>díjkártya-mock</div> }));

const ALAP = {
  id: 'job', shipper_id: 'shipper', carrier_id: 'carrier', title: 'Íróasztal Pécsre',
  pickup_address: 'Budapest, Margit körút 50.', dropoff_address: 'Pécs, Király utca 15.',
  pickup_lat: 47.51, pickup_lng: 19.04, dropoff_lat: 46.07, dropoff_lng: 18.23,
  accepted_price_huf: 24000, connection_fee_huf: 500, weight_kg: 55,
  recipient_name: null, recipient_phone: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chatProps = [];
  window.localStorage.clear();
  vi.mocked(api.listBids).mockResolvedValue([]);
  vi.mocked(api.listPhotos).mockResolvedValue([]);
});

describe('A1 — a kézbesítés lezárása', () => {
  it('címzett nélkül (régi sender_emergency jelöléssel is) zöld „átvételi kódoddal lezárva" sor, figyelmeztetés nélkül', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'delivered', paid_at: '2026-10-08T07:00:00Z', delivered_at: '2026-10-08T08:52:00Z',
      closed_by_code_type: 'sender_emergency',
    } as any);
    render(<ShipperPage />);
    const sor = await screen.findByTestId('kezbesites-lezaras');
    expect(sor.textContent).toMatch(/Kézbesítve: okt\. 8\., 10:52 — az átvételi kódoddal lezárva\./);
    expect(document.body.textContent).not.toMatch(/vészhelyzeti kód/i);
  });

  it('külön címzettnél a vészhelyzeti zárás továbbra is figyelmeztet', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'delivered', paid_at: '2026-10-08T07:00:00Z', delivered_at: '2026-10-08T08:52:00Z',
      closed_by_code_type: 'sender_emergency', recipient_name: 'Kiss Anna', recipient_phone: '+36301112233',
    } as any);
    render(<ShipperPage />);
    expect(await screen.findByText(/te vészhelyzeti kódoddal zárult le/)).toBeInTheDocument();
    expect(screen.queryByTestId('kezbesites-lezaras')).toBeNull();
  });
});

describe('A2 — a kódkártya szövege az állapotot követi', () => {
  it('címzett nélkül: csak akkor add meg, amikor a csomag már nálad van', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'accepted', paid_at: '2026-10-08T07:00:00Z', sender_delivery_code: '333444',
    } as any);
    render(<ShipperPage />);
    expect(await screen.findByText(/Te veszed át a csomagot/)).toHaveTextContent(/amikor a csomag már nálad van — a felvételkor ne/);
    expect(document.body.textContent).not.toMatch(/PIN/);
  });

  it('címzettel, felvétel előtt: a címzett a felvételkor KAPJA meg (nem „megkapta")', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'accepted', paid_at: '2026-10-08T07:00:00Z', sender_delivery_code: '333444',
      recipient_name: 'Kiss Anna', recipient_phone: '+36301112233',
    } as any);
    render(<ShipperPage />);
    const sor = await screen.findByText(/A címzett a saját átvételi kódját/);
    expect(sor.textContent).toMatch(/a felvételkor kapja meg SMS-ben/);
    expect(sor.textContent).not.toMatch(/emailben kapta meg/);
  });

  it('címzettel, úton: a címzett megkapta', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'in_progress', paid_at: '2026-10-08T07:00:00Z', sender_delivery_code: '333444',
      recipient_name: 'Kiss Anna', recipient_phone: '+36301112233', recipient_email: 'anna@pelda.hu',
    } as any);
    render(<ShipperPage />);
    const sor = await screen.findByText(/A címzett a saját átvételi kódját/);
    expect(sor.textContent).toMatch(/a felvételkor megkapta SMS-ben és e-mailben/);
  });
});

describe('A12 + Q8 — jelvény és díjkártya', () => {
  it('fizetetlen elfogadott fuvar: „Díjfizetésre vár", a díj nagyban, a kiválasztott szállító néven nevezve', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'accepted', paid_at: null } as any);
    vi.mocked(api.listBids).mockResolvedValue([
      { id: 'b1', job_id: 'job', carrier_id: 'carrier', carrier_name: 'Szabó Péter', status: 'accepted',
        amount_huf: 24000, revision: 1, message: 'Szívesen elviszem.', rating_count: 0 },
    ] as any);
    render(<ShipperPage />);
    expect(await screen.findByText('Díjfizetésre vár')).toBeInTheDocument();
    const kartya = screen.getByTestId('kapcsolatfelveteli-dij-kartya');
    expect(within(kartya).getByText('500 Ft')).toBeInTheDocument();
    expect(within(kartya).getByText('Kiválasztott szállító')).toBeInTheDocument();
    expect(within(kartya).getByText('Szabó Péter')).toBeInTheDocument();
    // fix2-review: a jelvény az értékelések számát mondja, nem a fuvar-előzményt.
    expect(within(kartya).getByText('Még nincs értékelése')).toBeInTheDocument();
    expect(kartya.textContent).not.toMatch(/Új szállító/);
    // Üres bizonyíték-fotó: egysoros helykitöltő, nincs „pickup/dropoff" szakszó.
    expect(document.body.textContent).toMatch(/Még nincs felvételi vagy lerakodási fotó/);
    expect(document.body.textContent).not.toMatch(/pickup|dropoff/);
  });

  it('fizetett fuvar: „Felvételre vár"', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'accepted', paid_at: '2026-10-08T07:00:00Z' } as any);
    render(<ShipperPage />);
    expect(await screen.findByText('Felvételre vár')).toBeInTheDocument();
  });
});

describe('A21 — lemondott fuvar', () => {
  it('nem biztat díjfizetésre, megmondja a pénzmozgást, és „Újra feladom" piszkozatot készít', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'cancelled', carrier_id: null, paid_at: null, cancelled_at: '2026-10-08T08:00:00Z',
    } as any);
    render(<ShipperPage />);
    const kartya = await screen.findByTestId('kapcsolatfelveteli-dij-kartya');
    expect(kartya.textContent).not.toMatch(/elfogadás után itt fizeted/);
    expect(kartya.textContent).toMatch(/Lemondva: okt\. 8\., 10:00\./);
    expect(kartya.textContent).toMatch(/Díjat nem fizettél, pénzmozgás nem történt\./);
    expect(document.body.textContent).not.toMatch(/Még nincs felvételi vagy lerakodási fotó/);

    within(kartya).getByRole('button', { name: /Újra feladom/ }).click();
    expect(mocks.push).toHaveBeenCalledWith('/dashboard/uj-fuvar');
    const kulcs = Object.keys(window.localStorage).find((k) => k.startsWith('gofuvar_uj_fuvar_piszkozat'));
    expect(kulcs, 'nem készült fuvarfeladási piszkozat').toBeTruthy();
    const mentett = JSON.parse(window.localStorage.getItem(kulcs!)!);
    expect(mentett.adat.form.title).toBe('Íróasztal Pécsre');
  });

  it('fizetett lemondásnál: a díj nem jár vissza (ÁSZF 4.1)', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...ALAP, status: 'cancelled', paid_at: '2026-10-08T07:00:00Z', cancelled_at: '2026-10-08T08:00:00Z',
    } as any);
    render(<ShipperPage />);
    const kartya = await screen.findByTestId('kapcsolatfelveteli-dij-kartya');
    expect(kartya.textContent).toMatch(/nem jár vissza, és másik fuvarra nem vihető át \(ÁSZF 4\.1\)/);
  });
});

describe('Q6 — az ajánlat-lista', () => {
  // A felvételi időpont „most"-hoz mért: rögzített óra, különben a teszt a nap
  // második felében (az időpont elmúltával) másik ágat látna (fix2-review).
  afterEach(() => { vi.useRealTimers(); });

  it('bizalmi sor, a díj egyszer, olvasható felvételi időpont, érthető visszaszállítás', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T08:45:00Z'));
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'bidding', carrier_id: null, paid_at: null } as any);
    vi.mocked(api.listBids).mockResolvedValue([
      { id: 'b1', job_id: 'job', carrier_id: 'c1', carrier_name: 'Szabó Péter', status: 'pending', revision: 1,
        amount_huf: 23000, eta_minutes: 300, created_at: '2026-10-08T08:40:00Z', return_policy: 'included',
        rating_avg: 4.8, rating_count: 12, carrier_vehicle: 'Ford Transit' },
      { id: 'b2', job_id: 'job', carrier_id: 'c2', carrier_name: 'Kovács Anna', status: 'pending', revision: 1,
        amount_huf: 25000, rating_count: 0 },
    ] as any);
    render(<ShipperPage />);
    expect(await screen.findByText('Minden ajánlattevő igazolta a személyazonosságát.')).toBeInTheDocument();
    expect(screen.getByText(/Bármelyiket választod:/)).toHaveTextContent('500 Ft kapcsolatfelvételi díj');
    // Egyforma díjnál a kártyán nem ismételjük.
    expect(screen.queryByText(/Ennél az ajánlatnál a kapcsolatfelvételi díj/)).toBeNull();
    expect(screen.getByText(/Várható felvétel: kb\. okt\. 8\., 15:40/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/~300 perc/);
    expect(screen.getByText(/5 munkanapon belül külön díj nélkül visszaviszi hozzád/)).toBeInTheDocument();
    expect(screen.getByText('Még nincs értékelése')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Új szállító/);
    expect(screen.getByText(/Ford Transit/)).toBeInTheDocument();
  });

  it('eltérő díjsávnál a drágább ajánlat kártyáján is ott a díja', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'bidding', carrier_id: null, paid_at: null } as any);
    vi.mocked(api.listBids).mockResolvedValue([
      { id: 'b1', job_id: 'job', carrier_id: 'c1', carrier_name: 'A', status: 'pending', revision: 1, amount_huf: 45000 },
      { id: 'b2', job_id: 'job', carrier_id: 'c2', carrier_name: 'B', status: 'pending', revision: 1, amount_huf: 55000 },
    ] as any);
    render(<ShipperPage />);
    // (az ft() a négyjegyű számot is tagolja: „1 000 Ft")
    expect(await screen.findByText(/Ennél az ajánlatnál a kapcsolatfelvételi díj/)).toHaveTextContent(/1\s?000 Ft/);
    expect(screen.getAllByText(/Ennél az ajánlatnál/)).toHaveLength(1);
  });
});

describe('Q18 — a chat tudja, díj előtt vagyunk-e', () => {
  it('a feladói oldal a partnert és a díj állapotát átadja', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...ALAP, status: 'accepted', paid_at: null } as any);
    render(<ShipperPage />);
    await screen.findByText('Díjfizetésre vár');
    expect(mocks.chatProps.at(-1)).toMatchObject({ partner: 'szallito', dijFizetve: false });
  });
});
