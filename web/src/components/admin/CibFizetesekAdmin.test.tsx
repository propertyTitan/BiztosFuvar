import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CibFizetesekAdmin from './CibFizetesekAdmin';
import { api } from '@/api';

// Admin „Kártyás fizetések (CIB)" blokk (CIB PR-3): kereső, állapot-szűrő,
// részletpanel a banki üzenetnaplóval, másolható titkosított napló a banki
// kivizsgáláshoz, újraellenőrzés, és a kétes lezárás két döntése
// ConfirmDialog mögött (a „Lezárva" ANUM-ot és indoklást KÖVETEL).
const m = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => m.toast }));
vi.mock('@/api', async (orig) => {
  const valodi = await orig<typeof import('@/api')>();
  return {
    ...valodi,
    api: {
      adminCibKereses: vi.fn(), adminCibReszlet: vi.fn(),
      adminCibUjraellenorzes: vi.fn(), adminCibRendezes: vi.fn(),
    },
  };
});

const TRID = '1234567812345678';
const SOR = {
  trid: TRID, job_id: '11111111-2222-3333-4444-555555555555', allapot: 'ellenorzes', cib_state: 'close_unknown',
  amount_huf: 500, rc: null, anum: null, created_at: '2026-09-29T10:00:00Z', closed_at: null,
};
const RESZLET = {
  session: { payment_id: TRID, job_id: SOR.job_id, cib_state: 'close_unknown', state: 'pending', amount_huf: 500 },
  result: { rc: null, rt: null, anum: null, amo: 500, cur: 'HUF' },
  events: [{ created_at: '2026-09-29T10:00:05Z', status: 'Expired', event_type: 'webhook' }],
  messages: [
    { created_at: '2026-09-29T10:00:01Z', direction: 'ki', msgt: '10', endpoint: 'market', http_status: 200, rc: '00', error_class: null, raw: 'PID=ABC0001&CRYPTO=1&DATA=AAAA' },
    { created_at: '2026-09-29T10:03:00Z', direction: 'ki', msgt: '32', endpoint: 'market', http_status: null, rc: null, error_class: 'idotullepes', raw: 'PID=ABC0001&CRYPTO=1&DATA=BBBB' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.adminCibKereses).mockResolvedValue({ items: [SOR], total: 1 } as any);
  vi.mocked(api.adminCibReszlet).mockResolvedValue(RESZLET as any);
  vi.mocked(api.adminCibUjraellenorzes).mockResolvedValue({ ok: true } as any);
  vi.mocked(api.adminCibRendezes).mockResolvedValue({ ok: true, allapot: 'closed_ok' } as any);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

describe('CIB admin blokk', () => {
  it('lista: TrID, állapot, összeg; kereső és szűrő a lekérdezésbe kerül', async () => {
    render(<CibFizetesekAdmin />);
    expect(await screen.findByText(TRID)).toBeInTheDocument();
    expect(screen.getByText('Kártyás fizetések (CIB)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/TrID, ANUM vagy fuvar/), { target: { value: 'AB1234' } });
    fireEvent.change(screen.getByLabelText(/Állapot/), { target: { value: 'sikertelen' } });
    fireEvent.click(screen.getByRole('button', { name: /Keresés/ }));
    await waitFor(() => expect(api.adminCibKereses).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'AB1234', allapot: 'sikertelen' }),
    ));
  });

  it('a végpont hiánya (CIB kikapcsolva) nem hiba, csak jelzés', async () => {
    vi.mocked(api.adminCibKereses).mockRejectedValue(Object.assign(new Error('x'), { status: 404 }));
    render(<CibFizetesekAdmin />);
    expect(await screen.findByText(/nem érhető el/)).toBeInTheDocument();
  });

  it('részlet: banki üzenetnapló, másolás a banknak, újraellenőrzés', async () => {
    render(<CibFizetesekAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
    const panel = await screen.findByTestId('cib-reszlet');
    expect(within(panel).getByText('MSGT32')).toBeInTheDocument();
    expect(within(panel).getByText('idotullepes')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: /Titkosított napló másolása a banknak/ }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const masolt = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    expect(masolt).toContain(TRID);
    expect(masolt).toContain('DATA=AAAA');
    expect(masolt).toContain('DATA=BBBB');

    fireEvent.click(within(panel).getByRole('button', { name: /Újraellenőrzés/ }));
    await waitFor(() => expect(api.adminCibUjraellenorzes).toHaveBeenCalledWith(TRID));
  });

  it('close_unknown — „Lezárva": ANUM + indoklás nélkül nem megy ki; hibás ANUM-ra sem', async () => {
    render(<CibFizetesekAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
    const panel = await screen.findByTestId('cib-reszlet');
    fireEvent.click(within(panel).getByRole('button', { name: /^Lezárva/ }));
    // A ConfirmDialog háttere ÉS a doboza is role=dialog — a belső a doboz.
    const dialog = (await screen.findAllByRole('dialog')).at(-1)!;
    // Üresen: a ConfirmDialog nem engedi tovább.
    fireEvent.click(within(dialog).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibRendezes).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/ANUM/), { target: { value: 'AB-12' } });
    fireEvent.change(within(dialog).getByLabelText(/Indoklás/), { target: { value: 'A bank levélben megerősítette a lezárást.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibRendezes).not.toHaveBeenCalled();
    expect(m.toast.error).toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/ANUM/), { target: { value: 'AB1234' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibRendezes).toHaveBeenCalledWith(TRID, {
      eredmeny: 'lezarva', anum: 'AB1234', indoklas: 'A bank levélben megerősítette a lezárást.',
    }));
  });

  it('close_unknown — „Nem lezárva": indoklás kötelező (min. 10 karakter)', async () => {
    render(<CibFizetesekAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
    const panel = await screen.findByTestId('cib-reszlet');
    fireEvent.click(within(panel).getByRole('button', { name: /^Nem lezárva/ }));
    // A ConfirmDialog háttere ÉS a doboza is role=dialog — a belső a doboz.
    const dialog = (await screen.findAllByRole('dialog')).at(-1)!;
    fireEvent.change(within(dialog).getByLabelText(/Indoklás/), { target: { value: 'rövid' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rögzítés/ }));
    expect(api.adminCibRendezes).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText(/Indoklás/), { target: { value: 'A bank szerint a lezárás nem történt meg.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Rögzítés/ }));
    await waitFor(() => expect(api.adminCibRendezes).toHaveBeenCalledWith(TRID, {
      eredmeny: 'nem_lezarva', indoklas: 'A bank szerint a lezárás nem történt meg.',
    }));
  });

  it('nem kétes sornál nincs rendezés-gomb', async () => {
    vi.mocked(api.adminCibKereses).mockResolvedValue({ items: [{ ...SOR, allapot: 'sikeres', cib_state: 'closed_ok' }], total: 1 } as any);
    vi.mocked(api.adminCibReszlet).mockResolvedValue({ ...RESZLET, session: { ...RESZLET.session, cib_state: 'closed_ok', state: 'succeeded' } } as any);
    render(<CibFizetesekAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
    const panel = await screen.findByTestId('cib-reszlet');
    expect(within(panel).queryByRole('button', { name: /^Lezárva/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: /^Nem lezárva/ })).toBeNull();
  });
});
