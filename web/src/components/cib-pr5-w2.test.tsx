// =====================================================================
//  CIB PR-5 (web, W2) — a felület a backend (cib-pr5/backend, d0e1bba)
//  végleges szerződéséhez igazítva (2026-10-04)
//
//  1. ADMIN — KÉZI MŰVELETEK: a backend konfig NÉLKÜL is elérhető kézi
//     rendezést kapott (POST /payments/admin/cib/:trid/kezi-rendezes:
//     konyveles / lejaratas / visszaterites). A vészvisszaállás (a CIB_*
//     sorok törlése) után a függő kísérleteket semmi más nem zárja le; a
//     felületen eddig nem volt hozzá gomb. Pontosan azokban az állapotokban
//     kínáljuk, ahol a backend engedi, ConfirmDialog mögött, indoklással.
//  2. ADMIN — „LEZÁRVA": az RT opcionális (üresen a backend „Tranzakció
//     elfogadva" alapértéke); a „nem lezárva" kimenete „nem terhelt", nem
//     „sikertelen"; a 409-es kódok saját szöveget kapnak.
//  3. ADMIN — SZŰRŐ: csak a backend által elfogadott állapot megy ki (eddig
//     a felület szótára ment, minden szűrés 400-ra futott).
//  4. FELADÓ — EGYEZTETÉS ALATT: a backend a kétes kísérletet automatikusan
//     rendezi; a kártya és az eredményoldal ebben az állapotban is figyel.
// =====================================================================
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DijFizetesKartya from './DijFizetesKartya';
import CibFizetesekAdmin from './admin/CibFizetesekAdmin';
import EredmenyOldal from '../../app/fizetes/eredmeny/page';
import { api } from '@/api';

const m = vi.hoisted(() => ({
  params: new URLSearchParams('e=tok-1'),
  user: null as null | { id: string; role: string },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  socket: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => m.params,
  usePathname: () => '/dashboard/fuvar/job-1',
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
const SOR = {
  trid: TRID, job_id: JOB, allapot: 'feldolgozas', cib_state: 'closed_ok', amount_huf: 500,
  rc: '00', anum: 'AB1234', created_at: '2026-10-04T10:00:00Z', closed_at: '2026-10-04T10:02:00Z',
};
function reszlet(state: string, cibState: string) {
  return {
    session: { payment_id: TRID, job_id: JOB, state, cib_state: cibState, amount_huf: 500 },
    result: { rc: cibState === 'closed_ok' ? '00' : null, rt: null, anum: null, amo: 500, cur: 'HUF' },
    events: [],
    messages: [],
  };
}
const INDOKLAS = 'A CIB-konfiguráció visszaállítva, a bank naplója szerint rendben.';
const hiba = (code: string, status = 409) => Object.assign(new Error('nyers szerverszöveg'), { code, status });
const szoveg = () => document.body.textContent || '';

async function atfolyat(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function nyitReszlet(state: string, cibState: string) {
  vi.mocked(api.adminCibKereses).mockResolvedValue({ items: [{ ...SOR, cib_state: cibState }], total: 1 } as any);
  vi.mocked(api.adminCibReszlet).mockResolvedValue(reszlet(state, cibState) as any);
  render(<CibFizetesekAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
  return screen.findByTestId('cib-reszlet');
}
const dialogus = async () => (await screen.findAllByRole('dialog')).at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  m.params = new URLSearchParams('e=tok-1');
  m.user = null;
  window.history.replaceState({}, '', '/dashboard/fuvar/job-1');
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.getPublicConfig).mockResolvedValue({ teszt_uzem: false, kartyas_fizetes: 'eles' } as any);
  vi.mocked(api.adminCibRendezes).mockResolvedValue({ ok: true, allapot: 'nem_terhelt' } as any);
  vi.mocked(api.adminCibKeziRendezes).mockResolvedValue({ ok: true, allapot: 'sikeres' } as any);
  vi.mocked(api.adminCibUjraellenorzes).mockResolvedValue({ ok: true } as any);
});
afterEach(() => { vi.useRealTimers(); });

describe('admin — kézi műveletek (konfig nélkül is): csak ahol a backend engedi', () => {
  it('függő + closed_ok: „Könyvelés" — indoklás nélkül nem megy ki, indoklással igen (banki hivatkozás nélkül)', async () => {
    const panel = await nyitReszlet('pending', 'closed_ok');
    expect(within(panel).queryByRole('button', { name: /^Lejáratás/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Visszatérítve/ })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /^Könyvelés/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: 'rövid' } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibKeziRendezes).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibKeziRendezes).toHaveBeenCalledWith(TRID, { muvelet: 'konyveles', indoklas: INDOKLAS }));
    await waitFor(() => expect(m.toast.success).toHaveBeenCalled());
  });

  it('könyvelés, de a fuvar közben nem fizethető (könyvelési árva): a toast ezt mondja, nem „könyvelve"', async () => {
    vi.mocked(api.adminCibKeziRendezes).mockResolvedValue({ ok: true, allapot: 'ellenorzes' } as any);
    const panel = await nyitReszlet('pending', 'closed_ok');
    fireEvent.click(within(panel).getByRole('button', { name: /^Könyvelés/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibKeziRendezes).toHaveBeenCalled());
    await waitFor(() => expect(m.toast.info.mock.calls.length + m.toast.success.mock.calls.length).toBeGreaterThan(0));
    const osszes = [...m.toast.info.mock.calls, ...m.toast.success.mock.calls].flat().join(' ');
    expect(osszes).toMatch(/vissza kell téríteni|visszatérít/i);
  });

  it.each(['initializing', 'ready', 'redirected', 'authorized', 'closing'])('függő + %s: csak „Lejáratás"; a határidő előtti 409 saját szöveget kap', async (cs) => {
    vi.mocked(api.adminCibKeziRendezes).mockRejectedValue(hiba('CIB_DEADLINE_NOT_PASSED'));
    const panel = await nyitReszlet('pending', cs);
    expect(within(panel).queryByRole('button', { name: /^Könyvelés/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Visszatérítve/ })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /^Lejáratás/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibKeziRendezes).toHaveBeenCalledWith(TRID, { muvelet: 'lejaratas', indoklas: INDOKLAS }));
    await waitFor(() => expect(m.toast.error).toHaveBeenCalled());
    expect(m.toast.error.mock.calls.flat().join(' ')).toMatch(/határidő/);
    expect(m.toast.error.mock.calls.flat().join(' ')).not.toContain('nyers szerverszöveg');
  });

  it('könyvelési árva (needs_review + closed_ok): „Visszatérítve" — a banki hivatkozás a kérésbe kerül, a hibás nem megy ki', async () => {
    const panel = await nyitReszlet('needs_review', 'closed_ok');
    expect(within(panel).queryByRole('button', { name: /^Könyvelés/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Lejáratás/ })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: /^Visszatérítve/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.change(within(d).getByLabelText(/Banki hivatkozás/), { target: { value: 'AB#12' } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibKeziRendezes).not.toHaveBeenCalled();
    expect(m.toast.error).toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/Banki hivatkozás/), { target: { value: ' CIB-REF 2026/10.04 ' } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibKeziRendezes).toHaveBeenCalledWith(TRID, {
      muvelet: 'visszaterites', indoklas: INDOKLAS, banki_hivatkozas: 'CIB-REF 2026/10.04',
    }));
  });

  it.each([
    ['pending', 'close_unknown'],
    ['succeeded', 'closed_ok'],
    ['closed', 'closed_ok'],
    ['pending', 'failed'],
    ['pending', 'expired'],
  ])('%s + %s: nincs kézi művelet', async (st, cs) => {
    const panel = await nyitReszlet(st, cs);
    for (const nev of [/^Könyvelés/, /^Lejáratás/, /^Visszatérítve/]) {
      expect(within(panel).queryByRole('button', { name: nev })).toBeNull();
    }
  });

  it('a kézi művelet rögzítése dupla kattintásra is EGY kérés', async () => {
    vi.mocked(api.adminCibKeziRendezes).mockImplementation(() => new Promise(() => {}));
    const panel = await nyitReszlet('pending', 'closed_ok');
    fireEvent.click(within(panel).getByRole('button', { name: /^Könyvelés/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibKeziRendezes).toHaveBeenCalled());
    expect(api.adminCibKeziRendezes).toHaveBeenCalledTimes(1);
  });

  it('a tételen dolgozó rendszer (CIB_ROW_BUSY) saját szöveget kap', async () => {
    vi.mocked(api.adminCibKeziRendezes).mockRejectedValue(hiba('CIB_ROW_BUSY'));
    const panel = await nyitReszlet('pending', 'closed_ok');
    fireEvent.click(within(panel).getByRole('button', { name: /^Könyvelés/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(m.toast.error).toHaveBeenCalled());
    expect(m.toast.error.mock.calls.flat().join(' ')).toMatch(/épp dolgozik/);
  });
});

describe('admin — a kétes kísérlet rendezése (C5, C6)', () => {
  it('„Lezárva": az RT opcionális — üresen nem megy ki (a backend „Tranzakció elfogadva" alapértéke áll)', async () => {
    const panel = await nyitReszlet('pending', 'close_unknown');
    fireEvent.click(within(panel).getByRole('button', { name: /^Lezárva/ }));
    const d = await dialogus();
    expect(within(d).getByLabelText(/RT/)).toHaveValue('Tranzakció elfogadva');
    fireEvent.change(within(d).getByLabelText(/ANUM/), { target: { value: 'AB1234' } });
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.change(within(d).getByLabelText(/RT/), { target: { value: '' } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibRendezes).toHaveBeenCalledWith(TRID, {
      eredmeny: 'lezarva', anum: 'AB1234', indoklas: INDOKLAS,
    }));
  });

  it('„Lezárva": 255 karakternél hosszabb vagy vezérlőkarakteres RT nem megy ki', async () => {
    const panel = await nyitReszlet('pending', 'close_unknown');
    fireEvent.click(within(panel).getByRole('button', { name: /^Lezárva/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/ANUM/), { target: { value: 'AB1234' } });
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.change(within(d).getByLabelText(/RT/), { target: { value: 'x'.repeat(256) } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibRendezes).not.toHaveBeenCalled();
    fireEvent.change(within(d).getByLabelText(/RT/), { target: { value: 'x'.repeat(255) } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibRendezes).toHaveBeenCalledWith(TRID, expect.objectContaining({ rt: 'x'.repeat(255) })));
  });

  it('„Lezárva", de MSGT32 nem ment ki (CIB_CLOSE_NOT_SENT): a toast megmondja, hogy csak „Nem lezárva" rendezhető', async () => {
    vi.mocked(api.adminCibRendezes).mockRejectedValue(hiba('CIB_CLOSE_NOT_SENT'));
    const panel = await nyitReszlet('pending', 'close_unknown');
    fireEvent.click(within(panel).getByRole('button', { name: /^Lezárva/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/ANUM/), { target: { value: 'AB1234' } });
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(m.toast.error).toHaveBeenCalled());
    expect(m.toast.error.mock.calls.flat().join(' ')).toMatch(/MSGT32/);
    expect(m.toast.error.mock.calls.flat().join(' ')).toMatch(/Nem lezárva/);
  });

  it('„Nem lezárva": a kimenet „nem terhelt" (nem „sikertelen"), a feladó újra fizethet', async () => {
    const panel = await nyitReszlet('pending', 'close_unknown');
    fireEvent.click(within(panel).getByRole('button', { name: /^Nem lezárva/ }));
    const d = await dialogus();
    fireEvent.change(within(d).getByLabelText(/Indoklás/), { target: { value: INDOKLAS } });
    fireEvent.click(within(d).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(m.toast.success).toHaveBeenCalled());
    const t = m.toast.success.mock.calls.flat().join(' ');
    expect(t).toMatch(/nem terhelt/i);
    expect(t).not.toMatch(/sikertelen/i);
  });

  it('az újraellenőrzés hiányos CIB-konfignál (CIB_UNAVAILABLE) a kézi műveletekre utal', async () => {
    vi.mocked(api.adminCibUjraellenorzes).mockRejectedValue(hiba('CIB_UNAVAILABLE'));
    const panel = await nyitReszlet('pending', 'redirected');
    fireEvent.click(within(panel).getByRole('button', { name: /Újraellenőrzés/ }));
    await waitFor(() => expect(m.toast.error).toHaveBeenCalled());
    expect(m.toast.error.mock.calls.flat().join(' ')).toMatch(/konfiguráció/);
  });
});

describe('admin — a lista szűrője a backend szótárát küldi', () => {
  it('a felület szótára („sikeres", „sikertelen", „nem_terhelt"…) nem választható; a nyers állapot igen', async () => {
    vi.mocked(api.adminCibKereses).mockResolvedValue({ items: [SOR], total: 1 } as any);
    render(<CibFizetesekAdmin />);
    expect(await screen.findByText(TRID)).toBeInTheDocument();
    const select = screen.getByLabelText(/Állapot/) as HTMLSelectElement;
    const ertekek = Array.from(select.options).map((o) => o.value);
    for (const rossz of ['sikeres', 'sikertelen', 'nem_terhelt', 'mar_fizetve', 'feldolgozas']) {
      expect(ertekek, `a(z) „${rossz}" szűrő 400-at kapna`).not.toContain(rossz);
    }
    fireEvent.change(select, { target: { value: 'failed' } });
    fireEvent.click(screen.getByRole('button', { name: /Keresés/ }));
    await waitFor(() => expect(api.adminCibKereses).toHaveBeenLastCalledWith(expect.objectContaining({ allapot: 'failed' })));
    fireEvent.change(select, { target: { value: 'ellenorzes' } });
    fireEvent.click(screen.getByRole('button', { name: /Keresés/ }));
    await waitFor(() => expect(api.adminCibKereses).toHaveBeenLastCalledWith(expect.objectContaining({ allapot: 'ellenorzes' })));
  });
});

describe('feladó — a fuvaroldalra visszavitt átirányító link (C2)', () => {
  it('?fizetes=link-lejart: nem ígér új fizetést (szünet / másik kísérlet mellett is ide jön)', async () => {
    // A backend ugyanezzel a paraméterrel küldi vissza a felhasznált, a
    // lejárt, a szünet-kapcsoló (CIB_UJ_FIZETES_TILTVA) alatti és a másik
    // kísérlet zárása miatti linket — az „indíts újat" ezek felében hamis.
    window.history.replaceState({}, '', '/dashboard/fuvar/job-1?fizetes=link-lejart');
    vi.mocked(api.getFeePayment).mockResolvedValue({
      provider_kind: 'cib', can_pay: false, pay_blocked_reason: 'szunetel', kupon_elerheto: false,
      open_attempt: null, last_result: null,
    } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    await waitFor(() => expect(m.toast.info).toHaveBeenCalled());
    const t = m.toast.info.mock.calls.flat().join(' ');
    expect(t).toMatch(/nem használható/);
    expect(t).not.toMatch(/indíts újat/);
    expect(await screen.findByTestId('dij-fizetes-tiltas')).toBeInTheDocument();
  });
});

describe('feladó — egyeztetés alatt (az automatikus egyeztetés megjelenik)', () => {
  it('az eredményoldal az „ellenőrzés" állapotban lassan tovább kérdez, és megmutatja az automatikus döntést', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getCibEredmeny)
      .mockResolvedValueOnce({
        trid: TRID, rc: null, rt: null, amo: 500, cur: 'HUF', anum: null, rc_csoport: null,
        allapot: 'ellenorzes', ok: null, job_id: 'job-1', ujra_fizetheto: false, frissult: null,
      } as any)
      .mockResolvedValue({
        trid: TRID, rc: 'TO', rt: 'Időtúllépés', amo: 500, cur: 'HUF', anum: null, rc_csoport: 'technikai',
        allapot: 'nem_terhelt', ok: 'bank_visszaforditotta', job_id: 'job-1', ujra_fizetheto: false, frissult: null,
      } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Ne fizess újra/);
    await atfolyat(21_000);
    expect(api.getCibEredmeny).toHaveBeenCalledTimes(2);
    expect(szoveg()).toMatch(/visszafordította/);
  });

  it('a 30 perces plafon után az „ellenőrzés" nézet kézi frissítést ad', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getCibEredmeny).mockResolvedValue({
      trid: TRID, rc: null, rt: null, amo: 500, cur: 'HUF', anum: null, rc_csoport: null,
      allapot: 'ellenorzes', ok: null, job_id: 'job-1', ujra_fizetheto: false, frissult: null,
    } as any);
    render(<EredmenyOldal />);
    await atfolyat();
    await atfolyat(31 * 60_000);
    const hivas = vi.mocked(api.getCibEredmeny).mock.calls.length;
    await atfolyat(10 * 60_000);
    expect(vi.mocked(api.getCibEredmeny).mock.calls.length, 'a lekérdezés vég nélkül fut').toBe(hivas);
    expect(screen.getByRole('button', { name: /Frissítés/ })).toBeInTheDocument();
  });

  it('a fuvar kártyája az „ellenőrzés" állapotban is figyel, és kézi frissítést ad', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getFeePayment)
      .mockResolvedValueOnce({
        provider_kind: 'cib', can_pay: false, pay_blocked_reason: 'masik_kiserlet_folyamatban', kupon_elerheto: false,
        open_attempt: { trid: TRID, started_at: new Date().toISOString(), allapot: 'ellenorzes' }, last_result: null,
      } as any)
      .mockResolvedValue({
        provider_kind: 'cib', can_pay: true, pay_blocked_reason: null, kupon_elerheto: false, open_attempt: null,
        last_result: {
          trid: TRID, rc: 'TO', rt: 'Időtúllépés', amo: 500, cur: 'HUF', anum: null, rc_csoport: 'technikai',
          allapot: 'nem_terhelt', ok: 'bank_visszaforditotta',
        },
      } as any);
    render(<DijFizetesKartya jobId="job-1" feeHuf={500} onFrissites={vi.fn()} />);
    await atfolyat();
    expect(screen.getByText('Ne fizess újra')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Állapot frissítése/ })).toBeInTheDocument();
    await atfolyat(21_000);
    expect(vi.mocked(api.getFeePayment).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(szoveg()).toMatch(/visszafordította/);
    expect(screen.queryByText('Ne fizess újra')).toBeNull();
  });
});
