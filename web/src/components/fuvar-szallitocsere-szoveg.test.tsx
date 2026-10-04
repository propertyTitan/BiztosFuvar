// =====================================================================
//  A feladói fuvaroldal „Másik szállítót választok" súgója (2026-10-04, CIB
//  PR-5 végső kör, az éles banki újrafuttatás lelete): fizetetlen,
//  elfogadott fuvaron eddig is „a befizetett díj erre a fuvarra érvényes
//  marad" állt — olyan díjat említett, amit a feladó még nem fizetett be. A
//  szöveg (és a megerősítő dialógus) mostantól a paid_at-hez igazodik.
// =====================================================================
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShipperPage from '../../app/dashboard/fuvar/[id]/page';
import { api } from '@/api';

const mocks = vi.hoisted(() => ({
  user: { id: 'shipper', role: 'shipper' },
  socket: { on: vi.fn(), off: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job' }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user }));
vi.mock('@/api', () => ({ api: { getJob: vi.fn(), listBids: vi.fn(), listPhotos: vi.fn() }, photoUrl: (url: string) => url }));
vi.mock('@/lib/socket', () => ({ getSocket: () => mocks.socket, joinUserRoom: vi.fn(), subscribeJob: vi.fn(() => vi.fn()) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@/components/LiveTrackingMap', () => ({ default: () => null }));
vi.mock('@/components/JobQuestions', () => ({ default: () => null }));
vi.mock('@/components/ReviewBox', () => ({ default: () => null }));
vi.mock('@/components/ChatBox', () => ({ default: () => null }));
vi.mock('@/components/Confetti', () => ({ default: () => null }));
vi.mock('@/components/TesztFizetesSav', () => ({ default: () => null }));
vi.mock('@/components/DijFizetesKartya', () => ({ default: () => null }));

const JOB = {
  id: 'job', shipper_id: 'shipper', carrier_id: 'carrier', title: 'Szállító-csere fuvar',
  pickup_address: 'Budapest', dropoff_address: 'Szeged', status: 'accepted', paid_at: null,
  accepted_price_huf: 15000, weight_kg: 10, connection_fee_huf: 500,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listBids).mockResolvedValue([]);
  vi.mocked(api.listPhotos).mockResolvedValue([]);
});

describe('„Másik szállítót választok"', () => {
  it('fizetetlen fuvaron nem említ befizetett díjat (sem a súgó, sem a dialógus)', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...JOB, paid_at: null } as any);
    render(<ShipperPage />);
    const gomb = await screen.findByRole('button', { name: /Másik szállítót választok/ });
    const doboz = gomb.parentElement!;
    expect(doboz.textContent, 'a súgó befizetett díjat említ, pedig a feladó még nem fizetett').not.toMatch(/befizetett/);
    expect(doboz.textContent).not.toMatch(/díjmentesen/);
    expect(doboz.textContent).toMatch(/kapcsolatfelvételi díj/);
    fireEvent.click(gomb);
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(d.textContent).not.toMatch(/befizetett/);
    expect(d.textContent).not.toMatch(/díjmentes/);
  });

  it('fizetett fuvaron a befizetett díj érvényes marad, az újraválasztás díjmentes', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...JOB, paid_at: '2026-10-04T10:00:00Z' } as any);
    render(<ShipperPage />);
    const gomb = await screen.findByRole('button', { name: /Másik szállítót választok/ });
    expect(gomb.parentElement!.textContent).toMatch(/befizetett díj erre\s+a fuvarra érvényes marad/);
    fireEvent.click(gomb);
    const d = (await screen.findAllByRole('dialog')).at(-1)!;
    expect(d.textContent).toMatch(/díjmentes/);
  });
});
