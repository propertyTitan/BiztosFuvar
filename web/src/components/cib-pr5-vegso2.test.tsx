// =====================================================================
//  CIB PR-5 (web) — UTOLSÓ CSISZOLÓ KÖR (2026-10-03). Mindegyik a javítás
//  nélkül (2c3b765) piros.
//   * hibás CIB-konfignál (a backend „szunetel"-t ad) a kártya nem ígér
//     „pár másodperc"-et, és a nyitott sáv sem „pár percet";
//   * az eredményoldal újrafizetés nélküli magyarázata a szünetet és a
//     próbálkozási korlátot is megnevezi;
//   * a „nem lezárva" szövege: „ha a bank zárolta az összeget, feloldja";
//     a banki visszafordítás szövege semleges („a bank nem terhelte") — az
//     elutasított eredetű egyeztetésre is igaz;
//   * az eredményoldalon (egy múltbeli, valódi CIB-teszt kísérlet) nincs
//     „a díjfizetés csak szimuláció" sáv;
//   * admin: a MSGT32-re kapott hiteles 00 bizonyítéka látszik, és a
//     „Nem lezárva" csak kifejezett megerősítéssel (a TrID begépelésével)
//     megy ki; a repülő zárás (CIB_CLOSE_IN_FLIGHT) saját szöveget kap.
// =====================================================================
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import TestModeBanner from './TestModeBanner';
import CibFizetesekAdmin from './admin/CibFizetesekAdmin';
import EredmenyOldal from '../../app/fizetes/eredmeny/page';
import { api } from '@/api';
import { adminMuveletHiba } from '@/lib/cibAdmin';
import { kartyaAllapot, nemTerheltMagyarazat, nyitottSavSzoveg } from '@/lib/cibFizetes';

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
      adminCibKeziRendezes: vi.fn(),
    },
  };
});

const TRID = '1234567812345678';
const JOB = '11111111-2222-3333-4444-555555555555';
const INDOKLAS = 'A CIB írásban megerősítette: a tranzakció nem zárult le.';
const szoveg = () => document.body.textContent || '';
const dialogus = async () => (await screen.findAllByRole('dialog')).at(-1)!;

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
  vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: false, kartyas_fizetes: 'eles', szimulalt_fizetes: false } as any);
  vi.mocked(api.adminCibRendezes).mockResolvedValue({ ok: true, allapot: 'nem_terhelt' } as any);
});
afterEach(() => { vi.useRealTimers(); });

// =====================================================================
describe('hibás CIB-konfig (szunetel) + függő kísérlet: nincs „pár másodperc"', () => {
  const SZUNET = {
    provider_kind: 'cib', can_pay: false, pay_blocked_reason: 'szunetel', kupon_elerheto: false,
    open_attempt: { trid: TRID, started_at: new Date().toISOString(), allapot: 'feldolgozas' }, last_result: null,
  };

  it('a kártya a szünetet mondja, és sem „pár másodperc", sem „pár percen belül" nem szerepel', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment).mockResolvedValue(SZUNET as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    await atfolyat();
    expect(screen.getByText('A kártyás fizetés átmenetileg szünetel')).toBeInTheDocument();
    expect(szoveg()).not.toMatch(/pár másodperc/);
    expect(szoveg(), 'a nyitott sáv a szünet alatt is percekre ígért eredményt').not.toMatch(/pár percen belül/);
    expect(szoveg()).toMatch(/ne indíts újat/);
  });

  it('a nyers lezárási állapot (closing) sem ad lezárás-dobozt szünet alatt', () => {
    expect(kartyaAllapot({
      ...SZUNET, open_attempt: { ...SZUNET.open_attempt, allapot: 'closing' },
    } as any)).toBe('nyitott');
    // Szünet nélkül (másik kísérlet zár) a lezárás-doboz marad.
    expect(kartyaAllapot({
      ...SZUNET, pay_blocked_reason: 'masik_kiserlet_folyamatban', open_attempt: { ...SZUNET.open_attempt, allapot: 'closing' },
    } as any)).toBe('lezaras');
  });

  it('a nyitott sáv szünet alatt időígéret nélkül szól', () => {
    const s = nyitottSavSzoveg(new Date().toISOString(), false, Date.now(), { szunetel: true });
    expect(s).not.toMatch(/pár perc/);
    expect(s).toMatch(/ne indíts újat/i);
    expect(s).toMatch(/kétszer biztosan nem terhelünk/);
  });
});

// =====================================================================
describe('a „nem terhelt" magyarázatok pontosak', () => {
  it('admin „nem lezárva": „ha a bank zárolta az összeget, feloldja" (nem állítja, hogy zárolt)', () => {
    const t = nemTerheltMagyarazat('admin_nem_lezarva');
    expect(t).toMatch(/ha a bank zárolta az összeget, feloldja/i);
    expect(t).not.toMatch(/A zárolt összeget a bank feloldja/);
    expect(t).toMatch(/nem terheltük/);
  });

  it('banki visszafordítás: semleges „a bank nem terhelte" — az elutasított eredetű egyeztetésre is igaz', () => {
    const t = nemTerheltMagyarazat('bank_visszaforditotta');
    expect(t).toMatch(/a bank nem terhelte/);
    expect(t).not.toMatch(/visszafordította|lezárás nélkül|feloldotta/);
    expect(t).toMatch(/nem terheltük/);
    expect(t).not.toMatch(/megváltozott/);
  });
});

// =====================================================================
describe('eredményoldal', () => {
  it('újrafizetés nélkül a magyarázat a szünetet és a próbálkozási korlátot is megnevezi', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      trid: TRID, rc: '05', rt: 'Elutasítva', amo: 500, cur: 'HUF', anum: null, rc_csoport: 'elutasitas',
      allapot: 'sikertelen', ok: null, job_id: 'job-1', ujra_fizetheto: false, frissult: null,
    } as any);
    m.pathname = '/fizetes/eredmeny';
    render(<EredmenyOldal />);
    await atfolyat();
    expect(szoveg()).toMatch(/most nem indítható új fizetés/);
    expect(szoveg(), 'a szünet nincs a felsorolt okok között').toMatch(/szünetel/);
    expect(szoveg(), 'a próbálkozási korlát nincs a felsorolt okok között').toMatch(/túl sok fizetési kísérlet/i);
  });

  it('egy múltbeli, valódi CIB-teszt kísérlet eredményoldalán nincs „a díjfizetés csak szimuláció" sáv', async () => {
    vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: null, szimulalt_fizetes: true } as any);
    m.pathname = '/fizetes/eredmeny';
    const { unmount } = render(<TestModeBanner />);
    await waitFor(() => expect(api.getPublicConfig).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId('teszt-uzem-sav')).toBeNull();
    expect(szoveg()).not.toMatch(/szimuláció/);
    unmount();
    // Máshol a stub-sáv megjelenik.
    m.pathname = '/dashboard/fuvar/job-1';
    render(<TestModeBanner />);
    expect((await screen.findByTestId('teszt-uzem-sav')).textContent).toMatch(/szimuláció/);
  });
});

// =====================================================================
describe('admin: a MSGT32-re kapott hiteles 00 bizonyítéka', () => {
  const sor = (tobb: Record<string, unknown> = {}) => ({
    trid: TRID, job_id: JOB, allapot: 'ellenorzes', cib_state: 'close_unknown', amount_huf: 500,
    rc: null, anum: null, created_at: '2026-10-04T10:00:00Z', closed_at: null, ok: null, ...tobb,
  });
  async function nyit(zaras00: Record<string, unknown> | null) {
    vi.mocked(api.adminCibKereses).mockResolvedValue({ items: [sor()], total: 1 } as any);
    vi.mocked(api.adminCibReszlet).mockResolvedValue({
      session: { payment_id: TRID, job_id: JOB, state: 'pending', cib_state: 'close_unknown', amount_huf: 500 },
      result: { rc: null, rt: null, anum: null, amo: 500, cur: 'HUF', ok: 'zaras_mezo_elteres' },
      zaras_00_valasz: zaras00,
      events: [],
      messages: [],
    } as any);
    render(<CibFizetesekAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
    return screen.findByTestId('cib-reszlet');
  }

  it('a bizonyíték látszik; a „Nem lezárva" csak a TrID begépelésével megy ki, a megerősítő zászlóval', async () => {
    const panel = await nyit({ at: '2026-10-04T10:05:00Z', kiserlet: 1 });
    const jelzes = within(panel).getByTestId('cib-zaras-00');
    expect(jelzes.textContent).toMatch(/00/);
    expect(jelzes.textContent).toMatch(/MSGT32/);
    fireEvent.click(within(panel).getByRole('button', { name: /^Nem lezárva/ }));
    const d = await dialogus();
    expect(d.textContent).toMatch(/00/);
    fireEvent.change(within(d).getByLabelText(/^Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibRendezes, 'megerősítés nélkül kiment').not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/Megerősítés/), { target: { value: '1111' } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibRendezes).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/Megerősítés/), { target: { value: ` ${TRID} ` } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibRendezes).toHaveBeenCalledWith(TRID, {
      eredmeny: 'nem_lezarva', indoklas: INDOKLAS, elso_00_ellenere: true,
    }));
  });

  it('bizonyíték nélkül nincs jelzés és nincs megerősítő mező', async () => {
    const panel = await nyit(null);
    expect(within(panel).queryByTestId('cib-zaras-00')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /^Nem lezárva/ }));
    const d = await dialogus();
    expect(within(d).queryByLabelText(/Megerősítés/)).toBeNull();
  });

  it('a 409 CIB_CLOSE_IN_FLIGHT saját szöveget kap (nem az általánost)', () => {
    const u = adminMuveletHiba(Object.assign(new Error('nyers'), { code: 'CIB_CLOSE_IN_FLIGHT', status: 409 }));
    expect(u.cim).toMatch(/zárási kérés/i);
    expect(u.szoveg).toMatch(/MSGT32/);
    expect(u.szoveg).not.toContain('nyers');
  });
});
