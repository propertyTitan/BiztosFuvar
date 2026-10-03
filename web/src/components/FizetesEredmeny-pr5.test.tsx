// =====================================================================
//  CIB PR-5 (web) — az eredményoldal őrei (2026-10-03)
//
//  Leletek: 9 (admin-egyeztetés utáni hamis „a bank nem fogadta el"), 11
//  (429-re is 3 mp-es ütem), 25c (újrapróba magyarázat nélkül hiányzik),
//  28 (az eredményoldalon nincs teszt-jelölés), és a valódi banknál talált
//  hibák: „A fizetett összeg (AMO)" sikertelen fizetésnél, a böngésző Vissza
//  gombja a bank POST-oldalára visz.
// =====================================================================
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EredmenyOldal from '../../app/fizetes/eredmeny/page';
import { api } from '@/api';
import { CIB_TESZT_SAV_SZOVEG } from '@/lib/cibFeliratok';

const m = vi.hoisted(() => ({
  params: new URLSearchParams('e=tok-1'),
  user: null as null | { id: string; role: string },
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => m.params,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => m.user }));
vi.mock('@/lib/socket', () => ({ getSocket: () => m.socket, joinUserRoom: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/api', async (orig) => {
  const valodi = await orig<typeof import('@/api')>();
  return {
    ...valodi,
    api: { getCibEredmeny: vi.fn(), getFeePayment: vi.fn(), payJob: vi.fn(), getPublicConfig: vi.fn() },
  };
});

const ALAP = {
  trid: '1234567812345678', rc: '00', rt: 'Sikeres tranzakció', amo: 500, cur: 'HUF', anum: 'AB1234',
  rc_csoport: null, job_id: 'job-1', ujra_fizetheto: false, frissult: null,
};

async function atfolyat(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  m.params = new URLSearchParams('e=tok-1');
  m.user = null;
  vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: false, kartyas_fizetes: 'eles' } as any);
});
afterEach(() => { vi.useRealTimers(); });

describe('az összeg felirata a kimenethez igazodik', () => {
  it.each(['sikertelen', 'nem_terhelt', 'mar_fizetve', 'ellenorzes'])('%s: nem „fizetett összeg", de az AMO ott van', async (allapot) => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, rc: '05', anum: null, allapot } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.queryByText('A fizetett összeg (AMO)')).toBeNull();
    expect(screen.getByText(/összege \(AMO\)/)).toBeInTheDocument();
    expect(screen.getByText('500 HUF')).toBeInTheDocument();
  });

  it('sikeres: a banki felirat szó szerint', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText('A fizetett összeg (AMO)')).toBeInTheDocument();
  });
});

describe('a „nem terhelt" kimenet oka (C5, lelet 9)', () => {
  it('admin-egyeztetés után: igaz ok, és nem „a bank nem fogadta el"', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...ALAP, rc: null, rt: null, anum: null, allapot: 'nem_terhelt', ok: 'admin_nem_lezarva', ujra_fizetheto: true,
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/bankkal egyeztettük/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/nem fogadta el|megváltozott/);
    expect(screen.getByRole('link', { name: /Belépés és újrapróba/ })).toBeInTheDocument();
  });

  it('a bank visszafordította: saját szöveg', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...ALAP, rc: null, anum: null, allapot: 'nem_terhelt', ok: 'bank_visszaforditotta',
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/visszafordította/)).toBeInTheDocument();
  });

  it('sikertelen RC nélkül: nem állítja, hogy a bank elutasította', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...ALAP, rc: null, rt: null, anum: null, allapot: 'sikertelen', ujra_fizetheto: true,
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(document.body.textContent).not.toMatch(/A bank nem fogadta el/);
    expect(document.body.textContent).toMatch(/nem terheltük/);
  });
});

describe('újrapróba nélkül is van magyarázat (lelet 25c)', () => {
  it('sikertelen, de nem fizethető újra: megmondja, miért nincs újrapróba', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...ALAP, rc: '05', anum: null, allapot: 'sikertelen', ujra_fizetheto: false,
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(/most nem indítható új fizetés/)).toBeInTheDocument();
  });
});

describe('429 → lassabb lekérdezés (lelet 11)', () => {
  it('a szerver kérte várakozást kivárja, nem kérdez 3 mp-enként', async () => {
    vi.mocked(api.getCibEredmeny)
      .mockResolvedValueOnce({ ...ALAP, rc: null, anum: null, allapot: 'feldolgozas' } as any)
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 429, retryAfterMs: 40_000 }))
      .mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    await atfolyat(3_100);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(2);
    await atfolyat(30_000);
    expect(api.getCibEredmeny, 'a 429 után 3 mp-enként tovább kérdezett').toHaveBeenCalledTimes(2);
    await atfolyat(11_000);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(3);
  });
});

describe('teszt-jelölés az eredményoldalon (lelet 28, C1)', () => {
  it('CIB tesztkörnyezetben a bank tesztkörnyezete jelölve', async () => {
    vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: 'teszt' } as any);
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(CIB_TESZT_SAV_SZOVEG)).toBeInTheDocument();
  });

  it('élesben és a konfiguráció hibájánál nincs teszt-jelölés', async () => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, allapot: 'sikeres' } as any);
    const { unmount } = render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.queryByText(CIB_TESZT_SAV_SZOVEG)).toBeNull();
    unmount();
    vi.mocked(api.getPublicConfig).mockRejectedValue(new Error('hálózat'));
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.queryByText(CIB_TESZT_SAV_SZOVEG)).toBeNull();
  });
});

describe('a böngésző Vissza gombja a bank oldalára vinne', () => {
  it.each(['feldolgozas', 'ellenorzes', 'nem_terhelt'])('%s: a „Vissza a fuvarhoz" az elsődleges gomb, és elmondjuk, miért', async (allapot) => {
    vi.mocked(api.getCibEredmeny).mockResolvedValue({ ...ALAP, rc: null, anum: null, allapot } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    const vissza = screen.getByRole('link', { name: /Vissza a fuvarhoz/ });
    expect(vissza.className.split(/\s+/)).not.toContain('btn-secondary');
    expect(screen.getByText(/böngésző Vissza gombja/)).toBeInTheDocument();
  });
});
