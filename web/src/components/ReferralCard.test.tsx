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
  it('kimondja, hogy a kupon 60 napig érvényes, és a díjfizetésnél váltódik be — nem a feladáskor', async () => {
    vi.mocked(api.getReferralInfo).mockResolvedValue(alap as any);
    render(<ReferralCard />);
    const p = await screen.findByText(/60\s+napig\s+érvényes/);
    expect(p.textContent).toMatch(/díjfizetés lépésénél váltódik be/);
    // A lejáratot a BEVÁLTÁSKOR (a díjfizetéskor) nézzük: a 60. nap körül
    // elfogadott, de csak később fizetett fuvarnál a „ha ezalatt szállítót
    // választasz” ígéret hamis volt (fix2-review).
    expect(p.textContent).toMatch(/ha ezen belül fizetnéd egy\s+fuvar kapcsolatfelvételi díját/);
    expect(p.textContent).not.toMatch(/ha ezalatt szállítót\s+választasz/);
    // A kupon a /pay-en (díjfizetéskor) váltódik be, a lejáratot is ott nézzük:
    // a „ha 60 napon belül adsz fel fuvart” ígéret az 58. napon feladott, de
    // a 61. napon elfogadott fuvarnál hamis volt (fix1-review).
    expect(p.textContent).not.toMatch(/adsz fel fuvart/);
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
