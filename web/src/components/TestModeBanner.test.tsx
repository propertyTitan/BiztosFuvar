// =====================================================================
//  A globális teszt-üzem sáv (CIB PR-5, C1 — 2026-10-03)
//
//  A sáv eddig FELTÉTEL NÉLKÜL azt írta minden oldalon: „valódi pénzmozgás
//  nincs, a fizetés csak szimuláció" — a launch után is ott maradt volna,
//  miközben a kártyás díjat valódi pénzzel fizetik. Mostantól a publikus
//  konfiguráció (GET /config/public) dönt, és hibánál SEMMIT nem mutat.
// =====================================================================
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPublicConfig = vi.fn();
vi.mock('@/api', () => ({ api: { getPublicConfig: (...a: unknown[]) => getPublicConfig(...a) } }));

async function renderSav() {
  // A konfiguráció modul-szintű gyorsítótárban él — minden teszt friss modult kap.
  vi.resetModules();
  const { default: TestModeBanner } = await import('./TestModeBanner');
  return render(<TestModeBanner />);
}

async function nincsSav() {
  await waitFor(() => expect(getPublicConfig).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByTestId('teszt-uzem-sav')).toBeNull();
  expect(document.body.textContent).not.toMatch(/szimuláció|valódi pénzmozgás nincs/);
}

beforeEach(() => { getPublicConfig.mockReset(); });

describe('TestModeBanner', () => {
  it('éles üzem (teszt_uzem=false) → nincs sáv', async () => {
    getPublicConfig.mockResolvedValue({ teszt_uzem: false, kartyas_fizetes: 'eles' });
    await renderSav();
    await nincsSav();
  });

  it('a konfiguráció hibája → nincs sáv (fail-closed, nincs „nincs valódi pénz" állítás)', async () => {
    getPublicConfig.mockRejectedValue(new Error('hálózat'));
    await renderSav();
    await nincsSav();
  });

  it('stub-üzem → „szimuláció"', async () => {
    getPublicConfig.mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: null });
    await renderSav();
    const sav = await screen.findByTestId('teszt-uzem-sav');
    expect(sav.textContent).toMatch(/szimuláció/);
  });

  it('CIB-teszt → a bank tesztkörnyezete', async () => {
    getPublicConfig.mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: 'teszt' });
    await renderSav();
    const sav = await screen.findByTestId('teszt-uzem-sav');
    expect(sav.textContent).toMatch(/CIB Bank tesztkörnyezet/);
  });

  it('teszt-üzem éles kártyás fizetés mellett → figyelmeztet, de nem állítja, hogy nincs valódi pénz', async () => {
    getPublicConfig.mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: 'eles' });
    await renderSav();
    const sav = await screen.findByTestId('teszt-uzem-sav');
    expect(sav.textContent).not.toMatch(/szimuláció|nincs valódi|valódi pénzmozgás nincs|valódi terhelés nincs/);
  });

  it('nem emoji az ikon (UI-ikon: lucide)', async () => {
    getPublicConfig.mockResolvedValue({ teszt_uzem: true, kartyas_fizetes: null });
    await renderSav();
    const sav = await screen.findByTestId('teszt-uzem-sav');
    expect(sav.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(sav.querySelector('svg')).not.toBeNull();
  });
});
