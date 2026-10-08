// =====================================================================
//  UX-átvizsgálás (2026-10-08) — komponens-őrök
//
//  A13 DisputeButton: nyitott vitánál tájékoztató kártya (14 munkanap)
//  A17 LiveTrackingMap: nem érintett nézőnek / nem úton lévő fuvarnál
//      nincs utolsó-pozíció kérés (eddig 403 + konzolhiba)
//  A17 ReviewBox: „Rólad — …" / „Tőled" címke, értékelés után más cím
//  A12 MyBids: fizetetlen nyertes fuvarnál nem „Tiéd a fuvar"
//  A22 Értesítések: relatív idő, emoji nélküli cím, szállítói üres állapot
//  Q18 ChatBox: a díj előtt előre jelzett kontakt-szabály, partner-fejléc
// =====================================================================
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: { id: 'u-feladó', role: 'shipper' } as { id: string; role: string } | null,
  mode: null as string | null,
  socket: { on: vi.fn(), off: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ useCurrentUser: () => mocks.user, readStoredMode: () => mocks.mode }));
vi.mock('@/lib/socket', () => ({ getSocket: () => mocks.socket, joinUserRoom: vi.fn(), subscribeJob: vi.fn(() => vi.fn()) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('./ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@react-google-maps/api', () => ({
  useJsApiLoader: () => ({ isLoaded: false, loadError: undefined }),
  GoogleMap: () => null, Marker: () => null, Polyline: () => null,
}));
vi.mock('@/api', () => ({
  api: {
    lastLocation: vi.fn(async () => null),
    getReviews: vi.fn(async () => []),
    submitReview: vi.fn(async () => ({})),
    myBids: vi.fn(async () => []),
    withdrawBid: vi.fn(),
    listNotifications: vi.fn(async () => []),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    getMessages: vi.fn(async () => []),
    sendMessage: vi.fn(),
    openDispute: vi.fn(),
  },
}));

import { api } from '@/api';
import DisputeButton from './DisputeButton';
import LiveTrackingMap from './LiveTrackingMap';
import ReviewBox from './ReviewBox';
import MyBids from './fuvarjaim/MyBids';
import ChatBox from './ChatBox';
import ErtesitesekOldal from '../../app/ertesitesek/page';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'u-feladó', role: 'shipper' };
  mocks.mode = null;
});

describe('A13 — DisputeButton', () => {
  it('nyitott vitánál tartós tájékoztatás a 14 munkanapos határidővel', () => {
    render(<DisputeButton jobId="j" status="disputed" paid />);
    expect(screen.getByText('Vita folyamatban')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toMatch(/legkésőbb 14 munkanapon belül írásban jelentkezik/);
  });
  it('fizetetlen fuvaron (a vita úgyis 409) nincs semmi', () => {
    const { container } = render(<DisputeButton jobId="j" status="disputed" paid={false} />);
    expect(container.textContent).toBe('');
  });
});

describe('A17 — LiveTrackingMap: utolsó pozíció csak úton, csak a feleknek', () => {
  const job = {
    id: 'j', shipper_id: 'u-feladó', carrier_id: 'u-szallito', status: 'in_progress',
    pickup_lat: 47.5, pickup_lng: 19.04, dropoff_lat: 47.45, dropoff_lng: 19.1,
  } as any;

  it('a felek úton lévő fuvarnál lekérik', async () => {
    render(<LiveTrackingMap job={job} />);
    await waitFor(() => expect(api.lastLocation).toHaveBeenCalledWith('j'));
  });

  it('nem érintett szállító (böngészés) nem kér — eddig 403 + konzolhiba', async () => {
    mocks.user = { id: 'idegen', role: 'carrier' };
    render(<LiveTrackingMap job={{ ...job, status: 'bidding', carrier_id: null }} />);
    render(<LiveTrackingMap job={job} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.lastLocation).not.toHaveBeenCalled();
  });

  it('elfogadott, még nem úton lévő fuvarnál a felek sem kérnek', async () => {
    render(<LiveTrackingMap job={{ ...job, status: 'accepted' }} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(api.lastLocation).not.toHaveBeenCalled();
  });
});

describe('A17 — ReviewBox', () => {
  it('a tételek címkéje: kiről, kitől; értékelés után „Az értékelésetek"', async () => {
    vi.mocked(api.getReviews).mockResolvedValue([
      { id: 'r1', reviewer_id: 'u-szallito', reviewee_id: 'u-feladó', reviewer_name: 'Kovács Anna', stars: 5, comment: 'Pontos volt.' },
      { id: 'r2', reviewer_id: 'u-feladó', reviewee_id: 'u-szallito', reviewer_name: 'Feladó Ferenc', stars: 4 },
    ] as any);
    render(<ReviewBox entityKey="job_id" entityId="j" cim="Értékeld a szállítót" kerdes="Hogyan teljesített?" />);
    expect(await screen.findByText('Rólad — Kovács Anna')).toBeInTheDocument();
    expect(screen.getByText('Tőled')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Az értékelésetek/ })).toBeInTheDocument();
    expect(screen.queryByText('Értékeld a szállítót')).toBeNull();
    expect(screen.queryByText('Hogyan teljesített?')).toBeNull();
  });

  it('értékelés előtt a hívó címe áll; nyitott vitánál figyelmeztető sor', async () => {
    vi.mocked(api.getReviews).mockResolvedValue([] as any);
    render(<ReviewBox entityKey="job_id" entityId="j" cim="Értékeld a szállítót" vitaNyitott />);
    await waitFor(() => expect(api.getReviews).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: /Értékeld a szállítót/ })).toBeInTheDocument();
    expect(screen.getByText('Az értékelést a vita lezárása után érdemes megírni.')).toBeInTheDocument();
    // A küldés gomb a sima elsődleges .btn — nem borostyán háttér, fehér szöveggel.
    const gomb = screen.getByRole('button', { name: /Válassz csillagot/ });
    expect(gomb.className).toBe('btn');
    expect((gomb as HTMLElement).style.background).toBe('');
  });
});

describe('A12 — MyBids', () => {
  const sor = {
    bid_id: 'b', job_terms_revision: 1, needs_reconfirmation: false, amount_huf: 24000, eta_minutes: null,
    message: null, bid_status: 'accepted', bid_created_at: '2026-10-08T08:00:00Z', job_id: 'j', job_title: 'Íróasztal',
    job_status: 'accepted', pickup_address: 'Budapest, Margit körút', dropoff_address: 'Pécs, Király utca',
    distance_km: 200, suggested_price_huf: 24000, accepted_price_huf: 24000, job_carrier_id: 'u-szallito',
  };

  it('fizetetlen nyertes fuvar: a feladó díjfizetésére vár — nem „Tiéd a fuvar"', async () => {
    mocks.user = { id: 'u-szallito', role: 'carrier' };
    vi.mocked(api.myBids).mockResolvedValue([{ ...sor, job_fee_paid: false }] as any);
    render(<MyBids />);
    expect(await screen.findByText(/Elfogadva — a feladó díjfizetésére vár/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Tiéd a fuvar/);
  });

  it('fizetett nyertes fuvar: indulhat', async () => {
    mocks.user = { id: 'u-szallito', role: 'carrier' };
    vi.mocked(api.myBids).mockResolvedValue([{ ...sor, job_fee_paid: true }] as any);
    render(<MyBids />);
    expect(await screen.findByText(/Indulhat a fuvar/)).toBeInTheDocument();
  });
});

describe('A22 — értesítések', () => {
  it('relatív idő a cím alatt, emoji nélküli cím, a teljes idő a title-ben', async () => {
    const most = Date.now();
    vi.mocked(api.listNotifications).mockResolvedValue([
      { id: 'n1', type: 'bid_accepted', title: '🎉 Megállapodás!', body: 'Az „Íróasztal" fuvarra tett ajánlatodat elfogadták.',
        link: null, read_at: null, created_at: new Date(most - 12 * 60_000).toISOString() },
    ] as any);
    render(<ErtesitesekOldal />);
    expect(await screen.findByText('Megállapodás!')).toBeInTheDocument();
    const ido = screen.getByText('12 perce');
    expect(ido.tagName).toBe('TIME');
    expect(ido.getAttribute('title')).toMatch(/^\d{4}\. /);
    expect(document.body.textContent).not.toMatch(/🎉/);
    expect(screen.getByRole('img', { name: 'Olvasatlan' })).toBeInTheDocument();
  });

  it('szállító módban az üres állapot az elérhető fuvarokra visz', async () => {
    mocks.mode = 'driver';
    vi.mocked(api.listNotifications).mockResolvedValue([] as any);
    render(<ErtesitesekOldal />);
    expect(await screen.findByRole('link', { name: 'Elérhető fuvarok' })).toHaveAttribute('href', '/sofor/fuvarok');
    expect(screen.queryByText('Adj fel egy fuvart')).toBeNull();
  });
});

describe('Q18 — ChatBox', () => {
  it('a díj előtt a mező fölött előre ott a kontakt-szabály; a fejléc megnevezi a partnert', async () => {
    render(<ChatBox entityKey="job_id" entityId="j" partner="szallito" dijFizetve={false} />);
    expect(screen.getByText('Üzenetek a szállítóval')).toBeInTheDocument();
    expect(screen.getByText(/A díj megfizetéséig telefonszám, e-mail-cím és link nem küldhető/)).toBeInTheDocument();
    expect(screen.getByText('Még nincs üzenet — kezdd te a beszélgetést.')).toBeInTheDocument();
  });

  it('a díj után nincs figyelmeztetés', () => {
    render(<ChatBox entityKey="job_id" entityId="j" partner="felado" dijFizetve />);
    expect(screen.getByText('Üzenetek a feladóval')).toBeInTheDocument();
    expect(screen.queryByText(/A díj megfizetéséig/)).toBeNull();
  });
});
