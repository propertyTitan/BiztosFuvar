// =====================================================================
//  CIB PR-5 (web) — a díjfizetési kártya őrei (2026-10-03)
//
//  Szerződés: C2 (CIB_PAUSED), C3 (pay_blocked_reason, a függő kísérlet a
//  stub-útra került fióknál is), C4 (kupon: csak a 45/2014-es nyilatkozat),
//  C5 (a „nem terhelt" kimenet oka). Leletek: 9, 10, 24, 25, 26, 29.
// =====================================================================
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import { api } from '@/api';
import { kulsoOldalraLep } from '@/lib/navigacio';

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
const STUB = { ...CIB, provider_kind: 'stub' };
const MOST = () => new Date().toISOString();

function kartya(props: Partial<React.ComponentProps<typeof DijFizetesKartya>> = {}) {
  return render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/dashboard/fuvar/job-1');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

describe('a letiltott gomb megmondja, miért (lelet 29)', () => {
  it('CIB: a hiányzó nyilatkozat(ok) neve a gombhoz kötve (aria-describedby), és frissül', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    kartya();
    const gomb = await screen.findByRole('button', { name: /Fizetés bankkártyával/ });
    expect(gomb).toBeDisabled();
    const id = gomb.getAttribute('aria-describedby');
    expect(id, 'a tiltott gomb nincs magyarázathoz kötve').toBeTruthy();
    const magyarazat = () => document.getElementById(id!)!;
    expect(magyarazat().textContent).toMatch(/mindkét/);
    fireEvent.click(screen.getByRole('checkbox', { name: /azonnali teljesítését/ }));
    expect(magyarazat().textContent).toMatch(/CIB Bank felé történő adattovábbítás/);
    fireEvent.click(screen.getByRole('checkbox', { name: /^Kijelentem, hogy az adatkezeléshez/ }));
    expect(gomb).not.toBeDisabled();
    expect(document.getElementById(id!)?.textContent || '').not.toMatch(/pipáld ki/);
  });

  it('stub: egy nyilatkozat — a magyarázat azt nevezi meg', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(STUB as any);
    kartya();
    const gomb = await screen.findByRole('button', { name: /Díj fizetése/ });
    expect(document.getElementById(gomb.getAttribute('aria-describedby') || '')?.textContent).toMatch(/azonnali teljesítés/);
  });
});

describe('kupon: nincs banki adattovábbítás (C4, lelet 26)', () => {
  it('beváltható kuponnál nincs CIB-nyilatkozat, a gomb az ingyenes kapcsolatfelvételt kínálja, a kérés hozzájárulás nélkül megy', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({ ...CIB, kupon_elerheto: true } as any);
    vi.mocked(api.payJob).mockResolvedValue({ paid_via_voucher: true, gateway_url: null, fee_huf: 0 } as any);
    kartya();
    const gomb = await screen.findByRole('button', { name: /Ingyenes kapcsolatfelvétel/ });
    expect(screen.queryByRole('checkbox', { name: /^Kijelentem, hogy az adatkezeléshez/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Fizetés bankkártyával/ })).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(gomb);
    await waitFor(() => expect(api.payJob).toHaveBeenCalledWith('job-1', true));
    expect(kulsoOldalraLep).not.toHaveBeenCalled();
  });
});

describe('tiltott fizetés: gomb nélkül, megnevezett okkal (C3, lelet 25)', () => {
  it.each([
    ['szunetel', /átmenetileg szünetel/],
    ['probalkozasi_limit', /Túl sok fizetési kísérlet/],
    ['nem_fizetheto', /A díj most nem fizethető/],
    ['masik_kiserlet_folyamatban', /Ne indíts újat/],
  ])('%s', async (ok, szoveg) => {
    vi.mocked(api.getFeePayment).mockResolvedValue({ ...CIB, can_pay: false, pay_blocked_reason: ok } as any);
    kartya();
    expect(await screen.findByText(szoveg)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fizetés bankkártyával/ })).toBeNull();
  });

  it('25b: egy újabb sikertelen kísérlet alatt is, ha a díj nem fizethető, nincs gomb és nincs „azonnal indíthatsz" ígéret', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban',
      last_result: { trid: '1', rc: '05', allapot: 'sikertelen' },
    } as any);
    kartya();
    await screen.findByText(/Ne indíts újat/);
    expect(screen.queryByRole('button', { name: /Fizetés bankkártyával/ })).toBeNull();
    expect(screen.queryByText(/Új fizetést azonnal indíthatsz/)).toBeNull();
  });

  it('CIB_PAUSED a /pay-re: saját szöveg, az állapotot újraolvassa', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue(CIB as any);
    vi.mocked(api.payJob).mockRejectedValue(Object.assign(new Error('SZERVER'), { code: 'CIB_PAUSED', status: 503 }));
    kartya();
    await screen.findByRole('button', { name: /Fizetés bankkártyával/ });
    for (const d of screen.getAllByRole('checkbox')) fireEvent.click(d);
    fireEvent.click(screen.getByRole('button', { name: /Fizetés bankkártyával/ }));
    await waitFor(() => expect(api.getFeePayment).toHaveBeenCalledTimes(2));
    expect(m.toast.error).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/szünetel/));
    expect(document.body.textContent).not.toMatch(/SZERVER/);
  });
});

describe('a függő kísérlet a stub-útra került fióknál is látszik (C3, lelet 24)', () => {
  it('close_unknown: „Ne fizess újra", nincs stub-gomb', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...STUB, can_pay: false, open_attempt: { trid: '9254951746052618', started_at: MOST(), allapot: 'ellenorzes' },
    } as any);
    kartya();
    expect(await screen.findByText(/Ne fizess újra/)).toBeInTheDocument();
    expect(screen.getByText(/9254951746052618/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Díj fizetése/ })).toBeNull();
  });
});

describe('a nem terhelt kimenet oka (C5, lelet 9)', () => {
  it('admin-egyeztetés: igaz ok, „a fuvar megváltozott" és „a bank nem fogadta el" nélkül, újrapróbával', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, last_result: { trid: '1', rc: null, amo: 500, allapot: 'nem_terhelt', ok: 'admin_nem_lezarva' },
    } as any);
    kartya();
    expect(await screen.findByText(/bankkal egyeztettük/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/megváltozott|nem fogadta el/);
    expect(screen.getByRole('button', { name: /Fizetés bankkártyával/ })).toBeInTheDocument();
  });

  // 2026-10-03 (a PR-5 web 1. javítóköre): az AMO banki felirata SZÓ SZERINT
  // marad; a nem sikeres kimenetet külön mondat mondja (a bank előírása).
  it('a sikertelen kísérlet adatsorában a banki AMO-felirat marad, a „nem terheltük" külön mondat', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, last_result: { trid: '1', rc: '05', amo: 500, allapot: 'sikertelen' },
    } as any);
    kartya();
    await screen.findByText(/Az előző fizetési kísérlet nem sikerült/);
    expect(screen.getByText('A fizetett összeg (AMO)')).toBeInTheDocument();
    expect(screen.queryByText(/összege \(AMO\)/)).toBeNull();
    expect(screen.getByTestId('amo-megjegyzes').textContent).toMatch(/nem terheltük/);
  });

  it('sikeres fizetés adatsorában a banki felirat szó szerint marad, megjegyzés nélkül', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, last_result: { trid: '1', rc: '00', amo: 500, anum: 'AB1234', allapot: 'sikeres' },
    } as any);
    kartya();
    await screen.findByText('Sikeres fizetés');
    expect(screen.getByText('A fizetett összeg (AMO)')).toBeInTheDocument();
    expect(screen.queryByTestId('amo-megjegyzes')).toBeNull();
  });
});

describe('a vissza nem tért kísérlet (lelet 10)', () => {
  it('nem biztat vakon új fizetésre: ha a bank oldalán befejezte, várjon', async () => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, open_attempt: { trid: '1', started_at: new Date(Date.now() - 3 * 60_000).toISOString(), allapot: 'feldolgozas' },
    } as any);
    kartya();
    const sav = await screen.findByText(/Egy korábbi fizetésed 3 perce indult/);
    expect(sav.textContent).toMatch(/befejezted/);
    expect(sav.textContent).toMatch(/ne indíts újat/i);
    expect(sav.textContent).not.toMatch(/nyugodtan indíts újat/);
  });

  it('a nyitott kísérlet állapotát lassan újraolvassa (a bank TO-ja / a háttér-lekérdezés után magától frissül)', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, open_attempt: { trid: '1', started_at: MOST(), allapot: 'feldolgozas' },
    } as any);
    kartya();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(api.getFeePayment).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    expect(vi.mocked(api.getFeePayment).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
