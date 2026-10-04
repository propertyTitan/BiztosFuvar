// =====================================================================
//  CIB PR-5 (web) — VÉGSŐ KÖR (2026-10-04). Mindegyik a javítás nélkül piros.
//   * admin-lista: a „Visszatérítve" pill a közölt okból (ok) jön, nem az
//     RC=00 + „nem_terhelt" párosból következtetve;
//   * admin-részletek: az egyeztetés feljegyzett első 00-ja (ANUM) látszik, és
//     a „Nem lezárva" csak kifejezett megerősítéssel (a feljegyzett ANUM
//     begépelésével) megy ki, a backend elso_00_ellenere zászlójával;
//   * a szünet alatt használt átirányító link (?fizetes=szunetel) a szünet
//     szövegét mutatja, nem a „lejárt link"-et.
// =====================================================================
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import CibFizetesekAdmin from './admin/CibFizetesekAdmin';
import { api } from '@/api';
import { adminMuveletHiba } from '@/lib/cibAdmin';

const m = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard/fuvar/job-1',
}));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => null }));
vi.mock('@/lib/socket', () => ({ getSocket: () => m.socket, joinUserRoom: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => m.toast }));
vi.mock('@/lib/navigacio', async (orig) => ({ ...(await orig<typeof import('@/lib/navigacio')>()), kulsoOldalraLep: vi.fn() }));
vi.mock('@/api', async (orig) => {
  const valodi = await orig<typeof import('@/api')>();
  return {
    ...valodi,
    api: {
      getFeePayment: vi.fn(), payJob: vi.fn(), getCibEredmeny: vi.fn(), getPublicConfig: vi.fn(),
      adminCibKereses: vi.fn(), adminCibReszlet: vi.fn(), adminCibUjraellenorzes: vi.fn(), adminCibRendezes: vi.fn(),
      adminCibKeziRendezes: vi.fn(),
    },
  };
});

const TRID = '1234567812345678';
const MASIK = '1234567812345679';
const JOB = '11111111-2222-3333-4444-555555555555';
const INDOKLAS = 'A CIB írásban megerősítette: a tranzakció nem zárult le.';
const sor = (tobb: Record<string, unknown>) => ({
  trid: TRID, job_id: JOB, allapot: 'nem_terhelt', cib_state: 'expired', amount_huf: 500,
  rc: '00', anum: null, created_at: '2026-10-04T10:00:00Z', closed_at: null, ok: null, ...tobb,
});
const dialogus = async () => (await screen.findAllByRole('dialog')).at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/dashboard/fuvar/job-1');
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: false, kartyas_fizetes: 'eles', szimulalt_fizetes: false } as any);
  vi.mocked(api.adminCibRendezes).mockResolvedValue({ ok: true, allapot: 'nem_terhelt' } as any);
});
afterEach(() => { vi.useRealTimers(); });

describe('admin-lista: a „Visszatérítve" pill a közölt okból jön', () => {
  it('RC=00 + nem_terhelt, ok nélkül → „Nem terhelt"; ok=admin_visszaterites → „Visszatérítve"', async () => {
    vi.mocked(api.adminCibKereses).mockResolvedValue({
      items: [sor({ trid: TRID, ok: null }), sor({ trid: MASIK, ok: 'admin_visszaterites', cib_state: 'closed_ok' })],
      total: 2,
    } as any);
    render(<CibFizetesekAdmin />);
    const elso = (await screen.findByText(TRID)).closest('tr')!;
    const masodik = screen.getByText(MASIK).closest('tr')!;
    expect(within(elso).queryByText('Visszatérítve'), 'az RC=00-ból következtetett „Visszatérítve"').toBeNull();
    expect(within(elso).getByText('Nem terhelt')).toBeInTheDocument();
    expect(within(masodik).getByText('Visszatérítve')).toBeInTheDocument();
  });
});

describe('admin-részletek: az egyeztetés első 00-ja', () => {
  async function nyit(elso00: Record<string, unknown> | null) {
    vi.mocked(api.adminCibKereses).mockResolvedValue({ items: [sor({ allapot: 'ellenorzes', cib_state: 'close_unknown', rc: null })], total: 1 } as any);
    vi.mocked(api.adminCibReszlet).mockResolvedValue({
      session: { payment_id: TRID, job_id: JOB, state: 'pending', cib_state: 'close_unknown', amount_huf: 500 },
      result: {
        rc: null, rt: null, anum: null, amo: 500, cur: 'HUF', ok: 'zaras_valasz_nelkul',
        ...(elso00 ? { egyeztetes_elso_00: elso00 } : {}),
      },
      events: [],
      messages: [],
    } as any);
    render(<CibFizetesekAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
    return screen.findByTestId('cib-reszlet');
  }

  it('a feljegyzett első 00 és ANUM látszik; a „Nem lezárva" csak a feljegyzett ANUM begépelésével megy ki, a zászlóval', async () => {
    const panel = await nyit({ anum: '654321', rt: 'Tranzakció elfogadva', at: '2026-10-04T10:30:00Z' });
    const jelzes = within(panel).getByTestId('cib-elso-00');
    expect(jelzes.textContent).toMatch(/654321/);
    expect(jelzes.textContent).toMatch(/00/);
    fireEvent.click(within(panel).getByRole('button', { name: /^Nem lezárva/ }));
    const d = await dialogus();
    expect(d.textContent).toMatch(/654321/);
    fireEvent.change(within(d).getByLabelText(/^Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    // Megerősítés nélkül nem megy ki.
    expect(api.adminCibRendezes).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/Megerősítés/), { target: { value: '111111' } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibRendezes).not.toHaveBeenCalled();
    expect(m.toast.error).toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/Megerősítés/), { target: { value: ' 654321 ' } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibRendezes).toHaveBeenCalledWith(TRID, {
      eredmeny: 'nem_lezarva', indoklas: INDOKLAS, elso_00_ellenere: true,
    }));
  });

  it('első 00 nélkül a „Nem lezárva" zászló és megerősítés nélkül megy', async () => {
    const panel = await nyit(null);
    expect(within(panel).queryByTestId('cib-elso-00')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /^Nem lezárva/ }));
    const d = await dialogus();
    expect(within(d).queryByLabelText(/Megerősítés/)).toBeNull();
    fireEvent.change(within(d).getByLabelText(/^Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibRendezes).toHaveBeenCalledWith(TRID, { eredmeny: 'nem_lezarva', indoklas: INDOKLAS }));
  });

  it('a backend 409 CIB_BANK_00_RECORDED kódja saját, a 00-ról szóló szöveget kap', () => {
    const u = adminMuveletHiba(Object.assign(new Error('nyers'), { code: 'CIB_BANK_00_RECORDED', status: 409 }));
    expect(u.cim).toMatch(/00/);
    expect(u.szoveg).not.toContain('nyers');
  });
});

describe('feladó — a szünet alatt használt átirányító link', () => {
  it('?fizetes=szunetel → a szünet szövege, nem a „lejárt link"', async () => {
    window.history.replaceState({}, '', '/dashboard/fuvar/job-1?fizetes=szunetel');
    vi.mocked(api.getFeePayment).mockResolvedValue({
      provider_kind: 'cib', can_pay: false, pay_blocked_reason: 'szunetel', kupon_elerheto: false,
      open_attempt: null, last_result: null,
    } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    await waitFor(() => expect(m.toast.info).toHaveBeenCalled());
    const t = m.toast.info.mock.calls.flat().join(' ');
    expect(t).toMatch(/szünetel/);
    expect(t).not.toMatch(/nem használható|nem érvényes/);
    // A paramétert levesszük (egy újratöltés ne ismételje).
    expect(window.location.search).not.toMatch(/fizetes=/);
  });
});
