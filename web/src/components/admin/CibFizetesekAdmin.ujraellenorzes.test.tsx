import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CibFizetesekAdmin from './CibFizetesekAdmin';
import { api } from '@/api';

// 2026-10-03 (CIB PR-5/B): az „Újraellenőrzés" visszajelzése azt mondja, ami
// TÉNYLEG történik — a backend válasza (azonnal fut, vagy legkorábban mikor)
// adja a szöveget. Eddig minden kattintásra „a lehető leghamarabb lefut" ment,
// a kétes tételen is, ahol a következő lépés egy késleltetett, csak-olvasó
// egyeztetés.
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
  events: [],
  messages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.adminCibKereses).mockResolvedValue({ items: [SOR], total: 1 } as any);
  vi.mocked(api.adminCibReszlet).mockResolvedValue(RESZLET as any);
});

async function kattint() {
  render(<CibFizetesekAdmin />);
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Részletek.*${TRID}`) }));
  const panel = await screen.findByTestId('cib-reszlet');
  fireEvent.click(within(panel).getByRole('button', { name: /Újraellenőrzés/ }));
  await waitFor(() => expect(api.adminCibUjraellenorzes).toHaveBeenCalledWith(TRID));
}

describe('CIB admin — Újraellenőrzés visszajelzése', () => {
  it('késleltetett lépés: a backend üzenete (mikor fut), nem a „lehető leghamarabb"', async () => {
    const uzenet = 'Az egyeztetés (csak-olvasó banki lekérdezés, zárás nélkül) legkorábban ekkor fut: 2026. 10. 03. 12:20:00.';
    vi.mocked(api.adminCibUjraellenorzes).mockResolvedValue({
      ok: true, utemezve: true, azonnal: false, kovetkezo_at: '2026-10-03T10:20:00.000Z', uzenet,
    });
    await kattint();
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Újraellenőrzés ütemezve', uzenet));
  });

  it('azonnal futó lépés: „elindítva" cím és a backend üzenete', async () => {
    const uzenet = 'A következő banki lépés most fut a háttérben — az eredmény pár másodperc múlva a részleteknél látszik.';
    vi.mocked(api.adminCibUjraellenorzes).mockResolvedValue({
      ok: true, utemezve: true, azonnal: true, kovetkezo_at: null, uzenet,
    });
    await kattint();
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Újraellenőrzés elindítva', uzenet));
  });

  it('régi (üzenet nélküli) válasz: a megszokott szöveg marad', async () => {
    vi.mocked(api.adminCibUjraellenorzes).mockResolvedValue({ ok: true });
    await kattint();
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith(
      'Újraellenőrzés ütemezve', 'A következő banki lekérdezés a lehető leghamarabb lefut.',
    ));
  });
});
