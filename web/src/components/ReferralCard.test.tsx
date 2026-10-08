// UX-review Q19 (2026-10-08): az ajánlói kupon 60 nap után lejár — a szöveg
// is mondja, és ha a backend küldi, a lejárat napja is látszik.
// A régi ReferralCarddal az első teszt piros.
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferralCard, { lejaratSzoveg } from './ReferralCard';
import { api } from '@/api';

vi.mock('@/api', () => ({ api: { getReferralInfo: vi.fn() } }));

const alap = {
  code: 'ABC2345', link: 'https://gofuvar.hu/bejelentkezes?mode=register&ref=ABC2345',
  totalReferred: 2, completedReferred: 1, availableVouchers: 1,
};

beforeEach(() => vi.resetAllMocks());

describe('ReferralCard', () => {
  it('kimondja, hogy a jutalom 60 napon belüli feladásra szól', async () => {
    vi.mocked(api.getReferralInfo).mockResolvedValue(alap as any);
    render(<ReferralCard />);
    expect(await screen.findByText(/60 napon\s+belül adsz fel fuvart/)).toBeInTheDocument();
  });

  it('a backend által küldött lejárati napot „Érvényes: …-ig” formában mutatja', async () => {
    vi.mocked(api.getReferralInfo).mockResolvedValue({ ...alap, voucherValidUntil: '2026-12-07' } as any);
    render(<ReferralCard />);
    expect(await screen.findByText(/Érvényes: 2026\. december 7-ig/)).toBeInTheDocument();
  });

  it('kupon nélkül nincs lejárati sor', async () => {
    vi.mocked(api.getReferralInfo).mockResolvedValue({ ...alap, availableVouchers: 0, voucherValidUntil: '2026-12-07' } as any);
    render(<ReferralCard />);
    await screen.findByText(/Hívd meg ismerőseidet/);
    expect(screen.queryByText(/Érvényes:/)).toBeNull();
  });
});

describe('lejaratSzoveg', () => {
  it('magyar dátum záró pont nélkül; érvénytelenre null', () => {
    expect(lejaratSzoveg('2026-12-07')).toBe('2026. december 7');
    expect(lejaratSzoveg('nem dátum')).toBeNull();
    expect(lejaratSzoveg(null)).toBeNull();
  });
});
