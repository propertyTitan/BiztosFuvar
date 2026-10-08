// UX A11 (2026-10-08): a vállalt fuvarok listája a közös állapot-jelvényt
// (StatusPill, szállítói nézet) használja — ugyanaz a felirat, mint a
// fuvaroldalon, és a fizetetlen „Elfogadva” megmondja, mire vár.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CarryingJobs from './CarryingJobs';
import { api } from '@/api';

vi.mock('next/link', () => ({ default: ({ children, href, ...p }: any) => <a href={href} {...p}>{children}</a> }));
vi.mock('@/api', () => ({ api: { myJobs: vi.fn() } }));

const alap = { pickup_address: 'Budapest', dropoff_address: 'Szeged', accepted_price_huf: 15000 };

describe('CarryingJobs — állapot-jelvény', () => {
  it('fizetetlen, fizetett és vitás fuvarnál a közös szállítói feliratot mutatja', async () => {
    vi.mocked(api.myJobs).mockResolvedValue([
      { ...alap, id: 'a', title: 'Fizetetlen', status: 'accepted', paid_at: null },
      { ...alap, id: 'b', title: 'Fizetett', status: 'accepted', paid_at: '2026-10-01T10:00:00Z' },
      { ...alap, id: 'c', title: 'Vitás', status: 'disputed', paid_at: '2026-10-01T10:00:00Z' },
    ] as any);
    render(<CarryingJobs />);
    expect(await screen.findByText('Elfogadva — a feladó díjfizetésére vár')).toBeInTheDocument();
    expect(screen.getByText('Indulhat a fuvar')).toBeInTheDocument();
    expect(screen.getByText('Vita folyamatban')).toBeInTheDocument();
    expect(screen.queryByText('Vitatott')).toBeNull();
  });
});
