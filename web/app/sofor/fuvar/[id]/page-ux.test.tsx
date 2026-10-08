// UX-review (2026-10-08) — a szállítói fuvaroldal:
//  A27: a díj előtt jelezzük, hogy a házszám a díj után jelenik meg;
//  A29: azonosítás nélkül az ajánlattételi űrlap tetején előre szólunk
//       (eddig csak az elküldéskor, 403-mal derült ki);
//  Q15: úton a CarrierTripPanel megkapja a hívható számokat, a vállalást és
//       a „Probléma bejelentése” horgonyt.
import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CarrierPage from './page';
import { api } from '@/api';

const mocks = vi.hoisted(() => ({ user: { id: 'carrier', role: 'carrier' }, panelProps: null as any, reviewProps: null as any, chatProps: null as any }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'job' }), useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user }));
vi.mock('@/api', () => ({
  api: { getJob: vi.fn(), listBids: vi.fn(), listPhotos: vi.fn(), getMyProfile: vi.fn() },
  photoUrl: (url: string) => url,
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => ({ on: vi.fn(), off: vi.fn() }), joinUserRoom: vi.fn(), subscribeJob: vi.fn(() => vi.fn()) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/LiveTrackingMap', () => ({ default: () => null }));
vi.mock('@/components/JobQuestions', () => ({ default: () => null }));
vi.mock('@/components/ReviewBox', () => ({ default: (p: any) => { mocks.reviewProps = p; return null; } }));
vi.mock('@/components/DisputeButton', () => ({ default: () => <button type="button">Problémám van ezzel a fuvarral</button> }));
vi.mock('@/components/ChatBox', () => ({ default: (p: any) => { mocks.chatProps = p; return null; } }));
vi.mock('@/components/CarrierTripPanel', () => ({ default: (p: any) => { mocks.panelProps = p; return null; } }));

const alap = {
  id: 'job', shipper_id: 'shipper', carrier_id: null, title: 'Kanapé', status: 'bidding', paid_at: null,
  pickup_address: '1132 Budapest, Váci út', dropoff_address: '6720 Szeged, Kárász utca', weight_kg: 10, terms_revision: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.panelProps = null;
  mocks.reviewProps = null;
  mocks.chatProps = null;
  vi.mocked(api.listBids).mockResolvedValue([]);
  vi.mocked(api.listPhotos).mockResolvedValue([]);
  vi.mocked(api.getMyProfile).mockResolvedValue({ identity_kyc_status: 'none' });
});

describe('szállítói fuvaroldal — díj előtt', () => {
  it('jelzi, hogy a házszám a díj után jelenik meg', async () => {
    vi.mocked(api.getJob).mockResolvedValue(alap as any);
    await act(async () => { render(<CarrierPage />); });
    expect(await screen.findByText(/házszám a kapcsolatfelvételi díj után jelenik meg/)).toBeInTheDocument();
  });

  it('azonosítás nélkül az űrlap tetején előre szól, és gombbal megnyitja a KYC-ablakot', async () => {
    vi.mocked(api.getJob).mockResolvedValue(alap as any);
    const esemenyek: any[] = [];
    const figyel = (e: Event) => esemenyek.push((e as CustomEvent).detail);
    window.addEventListener('gofuvar:kyc-required', figyel);
    try {
      await act(async () => { render(<CarrierPage />); });
      expect(await screen.findByText(/Az ajánlathoz egyszeri azonosítás kell – kb\. 2 perc/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Azonosítás most' }));
      expect(esemenyek).toEqual([{ code: 'IDENTITY_KYC_REQUIRED' }]);
    } finally {
      window.removeEventListener('gofuvar:kyc-required', figyel);
    }
  });

  it('az ajánlat mezője „Az ajánlatod (Ft)” — nem keverhető a platform ajánlott ársávjával (Q05)', async () => {
    vi.mocked(api.getMyProfile).mockResolvedValue({ identity_kyc_status: 'verified' });
    vi.mocked(api.getJob).mockResolvedValue(alap as any);
    await act(async () => { render(<CarrierPage />); });
    expect(await screen.findByLabelText('Az ajánlatod (Ft)')).toBeInTheDocument();
    expect(screen.queryByText(/Ajánlott fuvardíj/)).toBeNull();
  });

  it('igazolt szállítónak nincs azonosítási sáv', async () => {
    vi.mocked(api.getMyProfile).mockResolvedValue({ identity_kyc_status: 'verified' });
    vi.mocked(api.getJob).mockResolvedValue(alap as any);
    await act(async () => { render(<CarrierPage />); });
    await screen.findByRole('heading', { name: 'Kanapé' });
    expect(screen.queryByText(/egyszeri azonosítás kell/)).toBeNull();
  });
});

describe('szállítói fuvaroldal — úton', () => {
  it('a panel megkapja a hívható számokat, a vállalást és a probléma-horgonyt', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...alap, carrier_id: 'carrier', status: 'in_progress', paid_at: '2026-10-01T10:00:00Z',
      pickup_address: 'Budapest, Váci út 12, 1132', recipient_phone: '+36307654321',
      contact: { role: 'shipper', name: 'Feladó', phone: '+36301234567', email: null },
    } as any);
    vi.mocked(api.listBids).mockResolvedValue([{
      id: 'b', job_id: 'job', carrier_id: 'carrier', status: 'accepted', amount_huf: 20000,
      return_policy: 'included', return_fee_huf: null,
    }] as any);
    await act(async () => { render(<CarrierPage />); });
    await screen.findByRole('heading', { name: 'Kanapé' });
    expect(mocks.panelProps).toMatchObject({
      feladoTelefon: '+36301234567',
      cimzettTelefon: '+36307654321',
      problemaHref: '#problema-bejelentese',
      vallalas: expect.objectContaining({ return_policy: 'included' }),
    });
    expect(document.getElementById('problema-bejelentese')).not.toBeNull();
    expect(screen.queryByText(/házszám a kapcsolatfelvételi díj után/)).toBeNull();
  });
});

describe('szállítói fuvaroldal — chat és értékelés (Q17, A16)', () => {
  it('díj előtt a chat tudja, hogy a feladóval beszél és a díj még nincs kifizetve', async () => {
    vi.mocked(api.getJob).mockResolvedValue({ ...alap, carrier_id: 'carrier', status: 'accepted', paid_at: null } as any);
    await act(async () => { render(<CarrierPage />); });
    await screen.findByRole('heading', { name: 'Kanapé' });
    expect(mocks.chatProps).toMatchObject({ partner: 'felado', dijFizetve: false });
  });

  it('kézbesítés után a szállítói értékelés saját címet, kérdést és vita-jelzést kap', async () => {
    vi.mocked(api.getJob).mockResolvedValue({
      ...alap, carrier_id: 'carrier', status: 'delivered', paid_at: '2026-10-01T10:00:00Z',
      contact: { role: 'shipper', name: 'Feladó', phone: '+36301234567', email: null },
    } as any);
    await act(async () => { render(<CarrierPage />); });
    await screen.findByRole('heading', { name: 'Kanapé' });
    expect(mocks.chatProps).toMatchObject({ partner: 'felado', dijFizetve: true });
    expect(mocks.reviewProps).toMatchObject({
      cim: 'Értékeld a feladót',
      kerdes: expect.stringMatching(/egyeztetés és az átadás/),
      vitaNyitott: false,
    });
    expect(screen.queryByText(/Megvolt a csomag\?/)).toBeNull();
  });
});
