import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShipperPage from '../../app/dashboard/fuvar/[id]/page';
import CarrierPage from '../../app/sofor/fuvar/[id]/page';
import { api } from '@/api';

const mocks = vi.hoisted(() => ({ handlers: {} as Record<string, () => void>, user: { id: 'carrier', role: 'carrier' },
  socket: { on: vi.fn(), off: vi.fn() }, toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job' }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user }));
vi.mock('@/api', () => ({ api: { getJob: vi.fn(), listBids: vi.fn(), listPhotos: vi.fn(), uploadJobPhoto: vi.fn(),
  acceptBid: vi.fn(), acceptCounter: vi.fn() }, photoUrl: (url: string) => url }));
vi.mock('@/lib/socket', () => ({ getSocket: () => mocks.socket, joinUserRoom: vi.fn(),
  subscribeJob: (_id: string, handlers: typeof mocks.handlers) => { mocks.handlers = handlers; return vi.fn(); } }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@/components/LiveTrackingMap', () => ({ default: () => null }));
vi.mock('@/components/JobQuestions', () => ({ default: () => null }));
vi.mock('@/components/ReviewBox', () => ({ default: () => null }));
vi.mock('@/components/DisputeButton', () => ({ default: () => null }));
vi.mock('@/components/ChatBox', () => ({ default: () => <div>Fuvar chat</div> }));
vi.mock('@/components/Confetti', () => ({ default: () => null }));
vi.mock('@/components/TesztFizetesSav', () => ({ default: () => null }));
const job = { id: 'job', shipper_id: 'shipper', carrier_id: 'carrier', title: 'Helyreállt fuvar',
  pickup_address: 'Budapest', dropoff_address: 'Szeged', status: 'accepted', paid_at: '2026-09-15',
  accepted_price_huf: 15000, weight_kg: 10, connection_fee_huf: 500 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.id = 'carrier';
  vi.mocked(api.listBids).mockResolvedValue([]);
  vi.mocked(api.listPhotos).mockResolvedValue([]);
  vi.mocked(api.getJob).mockResolvedValue(job as any);
});

it.each([['shipper', ShipperPage], ['carrier', CarrierPage]])('%s: árváltozás után frissít, és csak új kattintásra fogad el', async (role, Page) => {
  mocks.user.id = role;
  vi.mocked(api.getJob).mockResolvedValue({ ...job, status: 'bidding', carrier_id: null, paid_at: null } as any);
  const bid = { id: 'bid', job_id: 'job', carrier_id: 'carrier', carrier_name: 'Teszt szállító', status: 'pending',
    revision: 2, amount_huf: 20000, counter_amount_huf: 20000, counter_by: role === 'shipper' ? 'carrier' : 'shipper' };
  vi.mocked(api.listBids).mockResolvedValue([bid] as any);
  const accept = vi.mocked(role === 'shipper' ? api.acceptBid : api.acceptCounter);
  accept.mockImplementationOnce(async () => {
    vi.mocked(api.listBids).mockResolvedValue([{ ...bid, revision: 3, counter_amount_huf: 30000 }] as any);
    throw Object.assign(new Error('Az ajánlat megváltozott, ellenőrizd az új árat.'), { code: 'OFFER_CHANGED' });
  }).mockResolvedValue({ ok: true } as any);
  render(<Page />);
  fireEvent.click(await screen.findByRole('button', { name: /Elfogadom/ }));
  await waitFor(() => expect(accept).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, counter_amount_huf: 20000 })));
  const retry = await screen.findByRole('button', { name: /Elfogadom.*30/ });
  expect(accept).toHaveBeenCalledTimes(1);
  expect(mocks.toast.error).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('megváltozott'));
  fireEvent.click(retry);
  await waitFor(() => expect(accept).toHaveBeenCalledTimes(2));
  expect(accept).toHaveBeenLastCalledWith(expect.objectContaining({ revision: 3, counter_amount_huf: 30000 }));
});

describe('P1-08/P1-10: tényleges részletoldal visszatérése', () => {
  it.each([['feladó', ShipperPage], ['szállító', CarrierPage]])('%s: hibás első kérés után az újrapróbálás visszaadja a felületet', async (_name, Page) => {
    vi.mocked(api.getJob).mockRejectedValueOnce(new Error('Átmeneti hálózati hiba'));
    render(<Page />);
    expect(await screen.findByText('Átmeneti hálózati hiba')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálom' }));
    expect(await screen.findByRole('heading', { name: 'Helyreállt fuvar' })).toBeInTheDocument();
    expect(screen.queryByText('Átmeneti hálózati hiba')).toBeNull();
  });

  it.each([['feladó', ShipperPage], ['szállító', CarrierPage]])('%s: reconnect frissíti a kiesés alatt változott állapotot', async (_name, Page) => {
    render(<Page />);
    await screen.findByRole('heading', { name: 'Helyreállt fuvar' });
    vi.mocked(api.getJob).mockResolvedValue({ ...job, status: 'in_progress', title: 'Már úton van' } as any);
    await act(async () => { mocks.handlers.onReconnect(); });
    expect(await screen.findByRole('heading', { name: 'Már úton van' })).toBeInTheDocument();
  });
});

it('P1-09: vitás szállítói oldalon elérhető a fotó/PIN, kézbesítés után is megmarad a vita és a chat', async () => {
  vi.mocked(api.getJob).mockResolvedValue({ ...job, status: 'disputed', status_before_dispute: 'in_progress' } as any);
  vi.mocked(api.uploadJobPhoto).mockImplementation(async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...job, status: 'disputed', status_before_dispute: 'delivered' } as any);
    return {} as any;
  });
  render(<CarrierPage />);
  await screen.findByRole('heading', { name: 'Helyreállt fuvar' });
  expect(screen.getByText('Fuvar chat')).toBeInTheDocument();
  fireEvent.change(document.getElementById('dropoff-photo')!, { target: { files: [new File(['x'], 'proof.png', { type: 'image/png' })] } });
  fireEvent.change(screen.getByPlaceholderText('6 számjegy'), { target: { value: '111222' } });
  fireEvent.click(screen.getByRole('button', { name: /Kézbesítés igazolása/ }));
  await waitFor(() => expect(api.uploadJobPhoto).toHaveBeenCalledWith('job', expect.any(File), 'dropoff', { deliveryCode: '111222' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /Kézbesítés igazolása/ })).toBeNull());
  expect(screen.getByText('Vitatott')).toBeInTheDocument();
  expect(screen.getByText('Fuvar chat')).toBeInTheDocument();
  expect(mocks.toast.success).toHaveBeenCalledWith('Csomag kézbesítve', expect.stringContaining('vita továbbra is nyitva'));
});
