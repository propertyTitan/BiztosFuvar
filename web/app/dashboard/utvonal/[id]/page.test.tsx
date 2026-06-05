import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FeladoUtvonalReszletek from './page';

// Feladó helyfoglalás fix útvonalra. Mockoljuk a Google Maps-es
// AddressAutocomplete-et, a usert és a navigációt. A méret-besorolás +
// cím-megerősítés validációt és a sikeres foglalást teszteljük.

const push = vi.fn();
const back = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'r1' }),
  useRouter: () => ({ push, back }),
}));

vi.mock('@/lib/auth', () => ({ useCurrentUser: () => null }));

// AddressAutocomplete helyett egy gomb, ami megerősített címet ad vissza.
// Két példány renderelődik (felvétel + lerakodás) → getAllBy...[0]/[1].
vi.mock('@/components/AddressAutocomplete', () => ({
  default: ({ onChange }: { onChange: (a: string, lat: number, lng: number) => void }) => (
    <button type="button" onClick={() => onChange('Teszt cím', 46.2, 20.1)}>
      mock-cim-megerosit
    </button>
  ),
}));

const getCarrierRoute = vi.fn();
const createRouteBooking = vi.fn();
vi.mock('@/api', () => ({
  api: {
    getCarrierRoute: (...a: any[]) => getCarrierRoute(...a),
    createRouteBooking: (...a: any[]) => createRouteBooking(...a),
  },
}));

const route = {
  id: 'r1',
  carrier_id: 'driver-1',
  title: 'Szeged → Budapest',
  departure_at: '2026-07-01T08:00:00.000Z',
  waypoints: [{ name: 'Szeged' }, { name: 'Budapest' }],
  vehicle_description: '',
  description: '',
  prices: [{ size: 'S', price_huf: 3000 }], // a sofőr CSAK S-t vállalja
};

async function fillDims(container: HTMLElement, user: ReturnType<typeof userEvent.setup>, dims: [string, string, string, string]) {
  const nums = container.querySelectorAll('input[type="number"]');
  await user.type(nums[0] as HTMLInputElement, dims[0]); // hossz
  await user.type(nums[1] as HTMLInputElement, dims[1]); // szélesség
  await user.type(nums[2] as HTMLInputElement, dims[2]); // magasság
  await user.type(nums[3] as HTMLInputElement, dims[3]); // súly
}

beforeEach(() => {
  vi.clearAllMocks();
  getCarrierRoute.mockResolvedValue(route);
  createRouteBooking.mockResolvedValue({ id: 'b1' });
});

describe('Foglalás-oldal — validáció', () => {
  it('S méret + megerősített címek → foglalás megy', async () => {
    const user = userEvent.setup();
    const { container } = render(<FeladoUtvonalReszletek />);
    await waitFor(() => expect(screen.getByText('Foglalás')).toBeInTheDocument());

    await fillDims(container, user, ['30', '20', '10', '2']); // → S
    const cimGombok = screen.getAllByText('mock-cim-megerosit');
    await user.click(cimGombok[0]); // felvétel
    await user.click(cimGombok[1]); // lerakodás

    await user.click(screen.getByRole('button', { name: /Helyet foglalok/ }));

    await waitFor(() => expect(createRouteBooking).toHaveBeenCalledTimes(1));
    const [routeId, body] = createRouteBooking.mock.calls[0];
    expect(routeId).toBe('r1');
    expect(body).toMatchObject({ length_cm: 30, width_cm: 20, height_cm: 10, weight_kg: 2 });
    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('a sofőr által nem vállalt méret (M) → hibaüzenet, nincs foglalás', async () => {
    const user = userEvent.setup();
    const { container } = render(<FeladoUtvonalReszletek />);
    await waitFor(() => expect(screen.getByText('Foglalás')).toBeInTheDocument());

    await fillDims(container, user, ['50', '40', '30', '10']); // → M, de a sofőr csak S-t visz
    const cimGombok = screen.getAllByText('mock-cim-megerosit');
    await user.click(cimGombok[0]);
    await user.click(cimGombok[1]);

    await user.click(screen.getByRole('button', { name: /Helyet foglalok/ }));

    expect(await screen.findByText(/Hiányzó adatok:.*nem vállalja/)).toBeInTheDocument();
    expect(createRouteBooking).not.toHaveBeenCalled();
  });
});
