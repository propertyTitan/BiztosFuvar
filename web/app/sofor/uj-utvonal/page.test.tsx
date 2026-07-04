import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UjUtvonal from './page';

// Útvonal-hirdetés form. A nehéz gyerekeket (Google Maps-es CityTagsInput,
// next/navigation, backend api) mockoljuk, és a "mi hiányzik" validációt
// + a sikeres publikálást teszteljük.

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: () => null }),
}));

// CityTagsInput helyett egy gomb, ami 2 várost állít be (indulás + cél).
vi.mock('@/components/CityTagsInput', () => ({
  default: ({ onChange }: { onChange: (w: any[]) => void }) => (
    <button type="button" onClick={() => onChange([{ name: 'Szeged' }, { name: 'Budapest' }])}>
      mock-2-varos
    </button>
  ),
}));

const createCarrierRoute = vi.fn();
vi.mock('@/api', () => ({
  api: {
    createCarrierRoute: (...a: any[]) => createCarrierRoute(...a),
    getCarrierRoute: vi.fn(),
    updateCarrierRoute: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  createCarrierRoute.mockResolvedValue({});
});

describe('Új útvonal form — validáció', () => {
  it('üres űrlap piszkozat-mentésekor a hiánylistát mutatja, nem hív API-t', async () => {
    const user = userEvent.setup();
    render(<UjUtvonal />);

    // A piszkozat gomb type="button" → megkerüli a natív required-validációt,
    // így a JS "mi hiányzik" ága fut le és üzenetet ad.
    await user.click(screen.getByRole('button', { name: 'Mentés piszkozatként' }));

    // BUG-024 fix után: a hiánylista EGY helyen jelenik meg (a gombok
    // alatti állandó hint), a submit nem duplikálja hibaüzenetként
    expect(screen.queryByText(/Hiányzó adatok:/)).not.toBeInTheDocument();
    expect(createCarrierRoute).not.toHaveBeenCalled();
    // A perzisztens hint is ott van az űrlap alján
    expect(screen.getByText(/A publikáláshoz még hiányzik:/)).toBeInTheDocument();
  });

  it('minden kitöltve (város + cím + idő + méret+ár) → publikál', async () => {
    const user = userEvent.setup();
    const { container } = render(<UjUtvonal />);

    // Megnevezés (a placeholder még a városok beállítása ELŐTT statikus)
    await user.type(screen.getByPlaceholderText(/Szeged → Budapest reggel/), 'Szeged → Bp');
    // 2 város a mockolt CityTagsInput-ból
    await user.click(screen.getByText('mock-2-varos'));
    // Indulás időpontja (datetime-local)
    const dt = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    await user.type(dt, '2026-07-01T08:00');
    // M méret már be van pipálva alapból → adjunk neki árat
    const numberInputs = container.querySelectorAll('input[type="number"]');
    // PACKAGE_SIZES sorrend: S, M, L, XL → a 2. (index 1) az M, ami enabled
    await user.type(numberInputs[1] as HTMLInputElement, '5000');

    await user.click(screen.getByRole('button', { name: 'Publikálás most' }));

    expect(createCarrierRoute).toHaveBeenCalledTimes(1);
    const body = createCarrierRoute.mock.calls[0][0];
    expect(body.title).toBe('Szeged → Bp');
    expect(body.status).toBe('open');
    expect(body.prices).toEqual(expect.arrayContaining([{ size: 'M', price_huf: 5000 }]));
    expect(push).toHaveBeenCalledWith('/sofor/utvonalaim');
  });
});
