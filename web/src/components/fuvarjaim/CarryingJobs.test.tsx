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

  it('mobil-elrendezés: a címoszlop alapszélessége 220 px — a hosszú felirat nem nyomja betűnyire', async () => {
    vi.mocked(api.myJobs).mockResolvedValue([
      { ...alap, id: 'a', title: 'IKEA PAX szekrény', status: 'accepted', paid_at: null },
    ] as any);
    render(<CarryingJobs />);
    const cim = await screen.findByRole('heading', { name: 'IKEA PAX szekrény' });
    const oszlop = cim.parentElement as HTMLElement;
    // A flex:1 (0-s alap) mellett a .row a jelvényt a cím mellé szorította, és
    // a .card overflow-wrap:anywhere szabálya betűnként tört (UX fix1).
    expect(oszlop.style.flex).toMatch(/220px/);
    expect(oszlop.style.minWidth).toMatch(/^0(px)?$/);
  });
});
