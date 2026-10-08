// UX-review Q17 (2026-10-08): szállító módban ?tab nélkül a „Vállalt fuvarok”
// nyílik (eddig mindig a feladói „Hirdetéseim”), és a fülsorrend a módot
// követi. A régi oldallal az első teszt piros.
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './page';
import { fulSorrend, alapFul } from './fulSorrend';

const mocks = vi.hoisted(() => ({ mode: null as 'driver' | 'shipper' | null, tab: null as string | null }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? mocks.tab : null) }) }));
vi.mock('@/lib/auth', () => ({ readStoredMode: () => mocks.mode }));
vi.mock('@/components/fuvarjaim/PostedJobs', () => ({ default: () => <p>FELADOTT-LISTA</p> }));
vi.mock('@/components/fuvarjaim/CarryingJobs', () => ({ default: () => <p>VALLALT-LISTA</p> }));
vi.mock('@/components/fuvarjaim/MyBids', () => ({ default: () => <p>AJANLAT-LISTA</p> }));
vi.mock('@/components/fuvarjaim/Bookings', () => ({ default: () => <p>FOGLALAS-LISTA</p> }));

beforeEach(() => { mocks.mode = null; mocks.tab = null; });

describe('Fuvarjaim — mód szerinti alapfül', () => {
  it('szállító módban ?tab nélkül a Vállalt fuvarok nyílik, ez az első fül', async () => {
    mocks.mode = 'driver';
    await act(async () => { render(<Page />); });
    expect(screen.getByText('VALLALT-LISTA')).toBeInTheDocument();
    expect(screen.queryByText('FELADOTT-LISTA')).toBeNull();
    const fulek = screen.getAllByRole('tab').map((t) => t.textContent?.trim());
    expect(fulek.slice(0, 3)).toEqual(['Vállalt fuvarok', 'Ajánlataim', 'Hirdetéseim']);
    expect(screen.getByRole('tab', { name: 'Vállalt fuvarok' })).toHaveAttribute('aria-selected', 'true');
  });

  it('feladó módban (és mentett mód nélkül) a Hirdetéseim nyílik', async () => {
    await act(async () => { render(<Page />); });
    expect(screen.getByText('FELADOTT-LISTA')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')[0].textContent?.trim()).toBe('Hirdetéseim');
  });

  it('a ?tab paraméter erősebb a módnál', async () => {
    mocks.mode = 'driver';
    mocks.tab = 'hirdeteseim';
    await act(async () => { render(<Page />); });
    expect(screen.getByText('FELADOTT-LISTA')).toBeInTheDocument();
  });
});

describe('fulSorrend / alapFul', () => {
  const fulek = [{ key: 'hirdeteseim' }, { key: 'vallalt' }, { key: 'licitjeim' }, { key: 'foglalasaim' }];
  it('szállítónál: vállalt, ajánlataim, hirdetéseim, foglalásaim', () => {
    expect(fulSorrend(fulek, 'driver').map((f) => f.key)).toEqual(['vallalt', 'licitjeim', 'hirdeteseim', 'foglalasaim']);
    expect(fulSorrend(fulek, 'shipper').map((f) => f.key)).toEqual(['hirdeteseim', 'vallalt', 'licitjeim', 'foglalasaim']);
  });
  it('alapfül', () => {
    expect(alapFul('driver')).toBe('vallalt');
    expect(alapFul('shipper')).toBe('hirdeteseim');
    expect(alapFul(null)).toBe('hirdeteseim');
  });
});
