// =====================================================================
//  CIB PR-5 (web) — 2. javítókör: a felület őrei (2026-10-04)
//
//  Blokkoló: az admin visszatérítése után (a bank TERHELT, a díjat
//  visszautaltuk) a kártya, az eredményoldal és az admin-lista is azt
//  mondta: „Nem terheltük a kártyádat" / „Nem terhelt" — a kötelező banki
//  adatsor RC=00-ja mellett. Nem blokkoló, olcsó pontok: a „nyitott" sáv
//  tiltás mellett is új fizetésre biztatott; a bank oldalán is lehető
//  kísérlet miatti tiltás „pár másodperc"-et ígért és vég nélkül kérdezett;
//  a lezárás-doboz lekérdezése sem állt le soha; az eredményoldalon a
//  globális sáv és az oldal saját CIB-teszt jelzése kétszer mondta ugyanazt.
// =====================================================================
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import TestModeBanner from './TestModeBanner';
import CibFizetesekAdmin from './admin/CibFizetesekAdmin';
import EredmenyOldal from '../../app/fizetes/eredmeny/page';
import { api } from '@/api';
import { CIB_TESZT_SAV_SZOVEG } from '@/lib/cibFeliratok';

const m = vi.hoisted(() => ({
  params: new URLSearchParams('e=tok-1'),
  pathname: '/dashboard/fuvar/job-1' as string | null,
  user: null as null | { id: string; role: string },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => m.params,
  usePathname: () => m.pathname,
}));
vi.mock('@/lib/auth', () => ({ useCurrentUser: () => m.user }));
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
    },
  };
});

const TRID = '1234567812345678';
/** A mai backend (cib-pr5/backend) admin-visszatérítése: „nem_terhelt", RC=00, ok nélkül. */
const VISSZATERITETT = {
  trid: TRID, rc: '00', rt: 'Tranzakció elfogadva', amo: 500, cur: 'HUF', anum: 'AB1234', rc_csoport: null,
  allapot: 'nem_terhelt', ok: null,
};
const CIB = { provider_kind: 'cib', can_pay: true, open_attempt: null, last_result: null, pay_blocked_reason: null };
const szoveg = () => document.body.textContent || '';
const megjegyzes = () => document.querySelector('[data-testid="amo-megjegyzes"]')?.textContent ?? null;

async function atfolyat(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.params = new URLSearchParams('e=tok-1');
  m.pathname = '/dashboard/fuvar/job-1';
  m.user = null;
  window.history.replaceState({}, '', '/dashboard/fuvar/job-1');
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: false, kartyas_fizetes: 'eles' } as any);
});
afterEach(() => { vi.useRealTimers(); });

describe('BLOKKOLÓ — a visszatérített díj: sehol „nem terheltük"', () => {
  it.each([
    ['ok nélkül (a mai backend)', {}],
    ['kifejezett okkal', { ok: 'admin_visszaterites' }],
    ['saját állapottal', { allapot: 'visszateritve' }],
  ])('a fuvar kártyája (%s): „visszatérítettük", és az AMO-mondat sem állít mást', async (_n, x) => {
    vi.mocked(api.getFeePayment).mockResolvedValue({ ...CIB, last_result: { ...VISSZATERITETT, ...x } } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    expect(await screen.findByText('Az előző fizetésed díját visszatérítettük')).toBeInTheDocument();
    expect(szoveg()).not.toMatch(/nem terheltük|nem véglegesítettük/i);
    expect(megjegyzes()).toMatch(/visszatérítettük/);
  });

  it.each([
    ['ok nélkül (a mai backend)', {}],
    ['kifejezett okkal', { ok: 'admin_visszaterites' }],
    ['saját állapottal', { allapot: 'visszateritve' }],
  ])('az eredményoldal (%s): saját cím és magyarázat, a banki adatsor feliratai változatlanok', async (_n, x) => {
    vi.useFakeTimers();
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...VISSZATERITETT, job_id: 'job-1', ujra_fizetheto: false, frissult: null, ...x,
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/visszatérítettük/i);
    expect(szoveg()).not.toMatch(/nem terheltük|nem véglegesítettük|A fizetés nem sikerült/i);
    expect(megjegyzes()).toMatch(/visszatérítettük/);
    expect(screen.getByText('A fizetett összeg (AMO)')).toBeInTheDocument();
  });

  it('az admin-lista sem írja „Nem terhelt"-nek a visszatérített (RC=00) sort', async () => {
    vi.mocked(api.adminCibKereses).mockResolvedValue({
      items: [{
        trid: TRID, job_id: null, allapot: 'nem_terhelt', cib_state: 'closed_ok', amount_huf: 500,
        rc: '00', anum: 'AB1234', created_at: '2026-10-04T10:00:00Z', closed_at: '2026-10-04T10:02:00Z',
      }],
      total: 1,
    } as any);
    render(<CibFizetesekAdmin />);
    expect(await screen.findByText(TRID)).toBeInTheDocument();
    const tabla = within(screen.getByRole('table'));
    expect(tabla.getByText('Visszatérítve')).toBeInTheDocument();
    expect(tabla.queryByText('Nem terhelt')).toBeNull();
    // A szűrő a backend szótárát kínálja: a „Visszatérítve" csak kijelzés.
    expect(screen.queryByRole('option', { name: 'Visszatérítve' })).toBeNull();
  });
});

describe('a „nyitott" sáv tiltás mellett nem biztat új fizetésre', () => {
  it.each(['szunetel', 'probalkozasi_limit', 'nem_fizetheto'])('%s: a tiltás-doboz igen, az „indíts újat" nem', async (ok) => {
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, pay_blocked_reason: ok,
      open_attempt: { trid: TRID, started_at: new Date().toISOString(), allapot: 'feldolgozas' },
    } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    expect(await screen.findByTestId('dij-fizetes-tiltas')).toBeInTheDocument();
    expect(screen.getByText(/nem fejeződött be/)).toBeInTheDocument();
    expect(szoveg()).not.toMatch(/bezártad a bank oldalát, indíts újat/);
  });
});

describe('a másik (a bank oldalán is lehető) kísérlet miatti tiltás', () => {
  it('stub-útra került fiók félbehagyott CIB-kísérlete: nem „pár másodperc", van kézi frissítés, és a lekérdezés leáll', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, provider_kind: 'stub', can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban',
      open_attempt: { trid: TRID, started_at: new Date().toISOString(), allapot: 'feldolgozas' },
    } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    await atfolyat();
    expect(screen.getByText('Egy korábbi fizetésed még folyamatban van')).toBeInTheDocument();
    expect(szoveg()).not.toMatch(/pár másodperc/);
    expect(screen.getByRole('button', { name: /Állapot frissítése/ })).toBeInTheDocument();
    await atfolyat(31 * 60_000);
    const hivas = vi.mocked(api.getFeePayment).mock.calls.length;
    await atfolyat(10 * 60_000);
    expect(vi.mocked(api.getFeePayment).mock.calls.length, 'a lekérdezés vég nélkül fut').toBe(hivas);
  });

  it('kártyás úton: az első percben „pár másodperc", egy perc után már percekről szól, kézi frissítéssel', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban',
      open_attempt: { trid: TRID, started_at: new Date().toISOString(), allapot: 'feldolgozas' },
    } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    await atfolyat();
    expect(screen.getByText(/lezárása folyamatban/)).toBeInTheDocument();
    expect(szoveg()).toMatch(/pár másodperc/);
    await atfolyat(61_000);
    expect(screen.getByText('Egy korábbi fizetésed még folyamatban van')).toBeInTheDocument();
    expect(szoveg()).not.toMatch(/pár másodperc/);
    expect(screen.getByRole('button', { name: /Állapot frissítése/ })).toBeInTheDocument();
  });

  it('a lezárás-doboz lekérdezése is leáll (30 perc után), és kézi frissítést kínál', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment).mockResolvedValue({
      ...CIB, can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban',
      open_attempt: { trid: TRID, started_at: new Date().toISOString(), allapot: 'closing' },
    } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    await atfolyat();
    expect(screen.getByText(/lezárása folyamatban/)).toBeInTheDocument();
    await atfolyat(31 * 60_000);
    const hivas = vi.mocked(api.getFeePayment).mock.calls.length;
    await atfolyat(10 * 60_000);
    expect(vi.mocked(api.getFeePayment).mock.calls.length, 'a lezárás-lekérdezés vég nélkül fut').toBe(hivas);
    expect(screen.getByRole('button', { name: /Állapot frissítése/ })).toBeInTheDocument();
  });
});

describe('az eredményoldalon a CIB-teszt jelzés egyszer szerepel', () => {
  it('a globális sáv a CIB-teszt üzenetet az eredményoldalon nem ismétli (az oldal saját jelzése marad)', async () => {
    vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: 'teszt' } as any);
    m.pathname = '/fizetes/eredmeny';
    const { unmount } = render(<TestModeBanner />);
    await waitFor(() => expect(api.getPublicConfig).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId('teszt-uzem-sav')).toBeNull();
    unmount();
    // Máshol a sáv megjelenik.
    m.pathname = '/dashboard/fuvar/job-1';
    render(<TestModeBanner />);
    expect(await screen.findByTestId('teszt-uzem-sav')).toBeInTheDocument();
  });

  it('az eredményoldal saját CIB-teszt jelzése megmarad', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: 'teszt' } as any);
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      ...VISSZATERITETT, allapot: 'sikeres', job_id: 'job-1', ujra_fizetheto: false,
    } as any);
    m.pathname = '/fizetes/eredmeny';
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByText(CIB_TESZT_SAV_SZOVEG)).toBeInTheDocument();
  });
});
