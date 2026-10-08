// UX-review A5 (2026-10-08): a szállító módú főoldal minden elfogadott
// fuvaron zöld „INDÍTÁS →” gombot mutatott — a még ki nem fizetetten is, ahol
// a csomag a díj előtt nem vehető át. A kártya most a közös
// lib/kovetkezoLepes logikából dolgozik. A régi kóddal az első teszt piros.
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HomeHub from './HomeHub';

const dashboard = vi.hoisted(() => ({ value: null as any }));
vi.mock('@/api', () => ({
  api: {
    getMyProfile: vi.fn().mockResolvedValue({ identity_kyc_status: 'verified' }),
    unreadNotificationCount: vi.fn().mockResolvedValue({ count: 0 }),
    getDriverDashboard: vi.fn(() => Promise.resolve(dashboard.value)),
    getGameStats: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('@/lib/auth', () => ({
  useCurrentUser: () => ({ id: 'u1', full_name: 'Teszt Szállító', role: 'shipper' }),
  readStoredMode: () => 'driver',
  writeStoredMode: vi.fn(),
}));
vi.mock('@/lib/i18n', () => ({
  useTranslation: () => ({ t: (s: string) => s }),
  formatPrice: (n: number) => `${n} Ft`,
}));

const fuvar = (over: Record<string, unknown>) => ({
  id: 'j1', title: 'Kanapé', status: 'accepted', paid_at: null,
  pickup_address: 'Budapest, Váci út, 1132', dropoff_address: 'Szeged, Kárász utca, 6720',
  accepted_price_huf: 20000, distance_km: 170, shipper_name: 'Feladó Ferenc', ...over,
});

function dash(job: Record<string, unknown>) {
  return {
    level: 1, levelName: 'Kezdő', isVerified: true, ratingCount: 0, availableVouchers: 0,
    weekEarnings: 0, weekDeliveries: 0, activeJobs: [job], pendingBidsCount: 0, nearbyJobsCount: 0,
  };
}

beforeEach(() => { localStorage.clear(); });

describe('HomeHub — Aktív fuvarjaid kártya', () => {
  it('fizetetlen elfogadott fuvaron NINCS indító gomb, csak „Díjfizetésre vár” jelvény', async () => {
    dashboard.value = dash(fuvar({ paid_at: null }));
    render(<HomeHub />);
    await waitFor(() => expect(screen.getByText('Kanapé')).toBeInTheDocument());
    expect(screen.getByText('Díjfizetésre vár')).toBeInTheDocument();
    expect(screen.queryByText(/INDÍTÁS/)).toBeNull();
    expect(screen.queryByText(/Felvétel →/)).toBeNull();
  });

  it('fizetett elfogadott fuvaron „Felvétel →”', async () => {
    dashboard.value = dash(fuvar({ paid_at: '2026-10-01T10:00:00Z' }));
    render(<HomeHub />);
    await waitFor(() => expect(screen.getByText(/Felvétel →/)).toBeInTheDocument());
    // UX A10/A11: a közös állapot-jelvény (szállítói nézet).
    expect(screen.getByText('Indulhat a fuvar')).toBeInTheDocument();
    expect(screen.queryByText('Díjfizetésre vár')).toBeNull();
  });

  it('úton lévő fuvaron „Kézbesítés →”, nem csupa nagybetűs „LEZÁRÁS”', async () => {
    dashboard.value = dash(fuvar({ status: 'in_progress', paid_at: '2026-10-01T10:00:00Z' }));
    render(<HomeHub />);
    await waitFor(() => expect(screen.getByText(/Kézbesítés →/)).toBeInTheDocument());
    expect(screen.queryByText(/LEZÁRÁS/)).toBeNull();
  });

  it('a díj előtti (irányítószám elöl álló) címből a település látszik, nem az irányítószám', async () => {
    dashboard.value = dash(fuvar({ pickup_address: '1132 Budapest, Váci út', dropoff_address: '6720 Szeged, Kárász utca' }));
    render(<HomeHub />);
    await waitFor(() => expect(screen.getByText('Kanapé')).toBeInTheDocument());
    expect(screen.getByText(/Budapest/).textContent).not.toMatch(/1132/);
  });
});
