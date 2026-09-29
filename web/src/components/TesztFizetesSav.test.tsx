import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A teszt-fizetési sáv KÉT fajtája (CIB PR-3): a mostani stub (sárga) és a
// CIB banki tesztkörnyezet (kék). A sáv a legerősebb védelem az ellen, hogy
// egy teszt-üzem élesben bent felejtődjön — ezért a szövegét is rögzítjük.
const getMyProfile = vi.fn();
vi.mock('@/api', () => ({ api: { getMyProfile: (...a: unknown[]) => getMyProfile(...a) } }));

async function renderSav() {
  // A komponens modul-szintű gyorsítótárat tart — minden teszt friss modult kap.
  vi.resetModules();
  const { default: TesztFizetesSav } = await import('./TesztFizetesSav');
  return render(<TesztFizetesSav />);
}

beforeEach(() => { getMyProfile.mockReset(); });

describe('TesztFizetesSav', () => {
  it("payment_test_kind='cib_teszt' → kék banki tesztkörnyezet-sáv, pontos szöveggel", async () => {
    getMyProfile.mockResolvedValue({ payment_test_mode: true, payment_test_kind: 'cib_teszt' });
    await renderSav();
    const sav = await screen.findByTestId('teszt-fizetes-sav');
    expect(sav).toHaveAttribute('data-fajta', 'cib_teszt');
    expect(sav.textContent).toContain(
      'CIB BANKI TESZTKÖRNYEZET – valódi terhelés nincs, csak a bank tesztkártyái működnek',
    );
    expect(sav.textContent).not.toContain('TESZT FIZETÉSI MÓD');
  });

  it("payment_test_kind='stub' → a mai sárga sáv", async () => {
    getMyProfile.mockResolvedValue({ payment_test_mode: true, payment_test_kind: 'stub' });
    await renderSav();
    const sav = await screen.findByTestId('teszt-fizetes-sav');
    expect(sav).toHaveAttribute('data-fajta', 'stub');
    expect(sav.textContent).toContain('TESZT FIZETÉSI MÓD');
    expect(sav.textContent).toMatch(/nem valódi/);
  });

  it('régi backend (csak payment_test_mode=true) → stub-sáv', async () => {
    getMyProfile.mockResolvedValue({ payment_test_mode: true });
    await renderSav();
    expect(await screen.findByTestId('teszt-fizetes-sav')).toHaveAttribute('data-fajta', 'stub');
  });

  it('éles üzem (payment_test_kind=null) → nincs sáv', async () => {
    getMyProfile.mockResolvedValue({ payment_test_mode: false, payment_test_kind: null });
    await renderSav();
    await waitFor(() => expect(getMyProfile).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('teszt-fizetes-sav')).toBeNull();
  });

  it('hibás profil-lekérés → nincs téves riasztás', async () => {
    getMyProfile.mockRejectedValue(new Error('hálózat'));
    await renderSav();
    await waitFor(() => expect(getMyProfile).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('teszt-fizetes-sav')).toBeNull();
  });
});
