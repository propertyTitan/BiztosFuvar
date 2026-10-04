// =====================================================================
//  CIB PR-5 (web) — a díjfizetési kártya, 1. javítókör (2026-10-03)
//
//  A PR-5 web-részének átnézéséből:
//   - kuponos módban egy CIB_CONSENT_REQUIRED válasz (a backend mégis a
//     kártyás útra esett) zsákutca volt: a kártya továbbra is elrejtette a
//     CIB-nyilatkozatot, így a fizetés soha nem indulhatott el;
//   - a kártya-specifikus tiltás (szünetel / kísérleti korlát) a bank nélküli
//     kupont is elrejtette;
//   - a kupon gombfelirata 390 px-en nem tördelhető (a .btn nowrap).
// =====================================================================
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import { api } from '@/api';

const m = vi.hoisted(() => ({
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => m.toast }));
vi.mock('@/lib/socket', () => ({ getSocket: () => m.socket }));
vi.mock('@/lib/navigacio', async (orig) => ({ ...(await orig<typeof import('@/lib/navigacio')>()), kulsoOldalraLep: vi.fn() }));
vi.mock('@/api', async (orig) => {
  const valodi = await orig<typeof import('@/api')>();
  return { ...valodi, api: { payJob: vi.fn(), getFeePayment: vi.fn() } };
});

const CIB = { provider_kind: 'cib', can_pay: true, open_attempt: null, last_result: null, pay_blocked_reason: null };
const KUPON = { ...CIB, kupon_elerheto: true };
const CIB_PIPA = /^Kijelentem, hogy az adatkezeléshez/;

function kartya() {
  return render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/dashboard/fuvar/job-1');
  Element.prototype.scrollIntoView = vi.fn();
});

describe('kupon: a backend mégis a kártyás útra esett (CIB_CONSENT_REQUIRED)', () => {
  it('megjelenik a CIB-nyilatkozat, és a következő kérés már a hozzájárulással megy — nincs zsákutca', async () => {
    // Az állapot újraolvasva is kupont mutat (pl. a kupon közben lejárt, de a
    // fee-payment még nem tudja) — a felület ekkor se ragadjon be.
    vi.mocked(api.getFeePayment).mockResolvedValue(KUPON as any);
    vi.mocked(api.payJob)
      .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'CIB_CONSENT_REQUIRED', status: 400 }))
      .mockResolvedValue({ provider: 'cib', redirect_url: 'https://api.example.test/payments/cib/tovabb/t1' } as any);
    kartya();
    fireEvent.click(await screen.findByRole('checkbox', { name: /azonnali teljesítését/ }));
    fireEvent.click(screen.getByRole('button', { name: /Ingyenes kapcsolatfelvétel/ }));
    await waitFor(() => expect(api.payJob).toHaveBeenCalledWith('job-1', true));
    const cibPipa = await screen.findByRole('checkbox', { name: CIB_PIPA });
    const gomb = screen.getByRole('button', { name: /Fizetés bankkártyával/ });
    expect(gomb).toBeDisabled();
    fireEvent.click(cibPipa);
    expect(gomb).not.toBeDisabled();
    fireEvent.click(gomb);
    await waitFor(() => expect(api.payJob).toHaveBeenLastCalledWith('job-1', true, true));
  });
});

describe('a kártya-specifikus tiltás nem rejti el a bank nélküli kupont', () => {
  it.each(['szunetel', 'probalkozasi_limit'])('%s + beváltható kupon, függő kísérlet nélkül: a kupon-gomb elérhető', async (ok) => {
    vi.mocked(api.getFeePayment).mockResolvedValue({ ...KUPON, can_pay: false, pay_blocked_reason: ok } as any);
    vi.mocked(api.payJob).mockResolvedValue({ paid_via_voucher: true, gateway_url: null, fee_huf: 0 } as any);
    kartya();
    const gomb = await screen.findByRole('button', { name: /Ingyenes kapcsolatfelvétel/ });
    expect(screen.queryByTestId('dij-fizetes-tiltas')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(gomb);
    await waitFor(() => expect(api.payJob).toHaveBeenCalledWith('job-1', true));
  });

  it('a nem kártya-specifikus tiltás (nem fizethető) és a függő kísérlet mellett a kupon sem kínálható', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({ ...KUPON, can_pay: false, pay_blocked_reason: 'nem_fizetheto' } as any);
    const { unmount } = kartya();
    expect(await screen.findByTestId('dij-fizetes-tiltas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ingyenes kapcsolatfelvétel/ })).toBeNull();
    unmount();
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...KUPON, can_pay: false, pay_blocked_reason: 'szunetel',
      open_attempt: { trid: '1', started_at: new Date().toISOString(), allapot: 'feldolgozas' },
    } as any);
    kartya();
    expect(await screen.findByTestId('dij-fizetes-tiltas')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ingyenes kapcsolatfelvétel/ })).toBeNull();
  });
});

describe('390 px: a hosszú gombfelirat tördelhető', () => {
  it('a fizetés gombja nem nowrap (a kupon-felirat a kártya szélén túl lógna)', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(KUPON as any);
    kartya();
    const gomb = await screen.findByRole('button', { name: /Ingyenes kapcsolatfelvétel/ });
    expect(gomb.style.whiteSpace).toBe('normal');
  });
});
