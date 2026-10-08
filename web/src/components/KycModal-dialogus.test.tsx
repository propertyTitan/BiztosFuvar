// UX-review A29 (2026-10-08): a KYC-ablak valódi párbeszédablak, igaz
// sikerszöveggel, tárolási tájékoztatással és mobilon kamera-gombbal.
// A régi KycModallal (sima <div>, „Most már feladhatsz fuvart.”) piros.
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KycModal from './KycModal';
import { api } from '@/api';

vi.mock('@/api', () => ({ api: { uploadKycDocument: vi.fn(), invalidateMyProfile: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());
afterEach(() => { Reflect.deleteProperty(window, 'matchMedia'); });

function nyit(detail: Record<string, unknown> = { code: 'DRIVER_KYC_REQUIRED' }) {
  render(<KycModal />);
  act(() => { window.dispatchEvent(new CustomEvent('gofuvar:kyc-required', { detail })); });
}

async function sikeresFeltoltes() {
  vi.mocked(api.uploadKycDocument).mockResolvedValue({ ok: true, status: 'verified', doc_type: 'id_card', file_url: '' });
  const input = document.getElementById('kyc-dokumentum') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['x'], 'szemelyi.jpg', { type: 'image/jpeg' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Dokumentum feltöltése' }));
  await waitFor(() => expect(screen.getByText(/Elfogadva!/)).toBeInTheDocument());
}

describe('KycModal — dialógus', () => {
  it('role=dialog, a címsorral megnevezve; az Escape bezárja', () => {
    nyit();
    expect(screen.getByRole('dialog', { name: 'Szállítói dokumentumok' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a bezáró gomb ikon-gomb „Bezárás” névvel, nem egy „x” betű', () => {
    nyit();
    const gomb = screen.getByRole('button', { name: 'Bezárás' });
    expect(gomb.textContent).toBe('');
  });

  it('megmondja, hol és meddig tároljuk a fotót', () => {
    nyit();
    expect(screen.getByText(/nem nyilvános, titkosított tárhelyen/)).toBeInTheDocument();
    expect(screen.getByText(/30 nappal töröljük/)).toBeInTheDocument();
  });
});

describe('KycModal — sikerképernyő', () => {
  it('az ajánlattételről szól, nem a feladásról, és visszavisz az ajánlathoz', async () => {
    nyit({ code: 'DRIVER_KYC_REQUIRED', forras: 'ajanlat' });
    await sikeresFeltoltes();
    expect(screen.getByText('Elfogadva! Most már tehetsz ajánlatot.')).toBeInTheDocument();
    expect(screen.queryByText(/feladhatsz fuvart/)).toBeNull();
    expect(api.invalidateMyProfile).toHaveBeenCalled();
    // A szállítói ág is személyi igazolványt küld (a backend csak id_card-ot fogad).
    expect(api.uploadKycDocument).toHaveBeenCalledWith(expect.any(File), 'id_card');
    fireEvent.click(screen.getByRole('button', { name: 'Vissza az ajánlathoz' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a főoldali felhívásból nyitva „Rendben” a gomb (nincs félbehagyott ajánlat)', async () => {
    nyit({ code: 'IDENTITY_KYC_REQUIRED', forras: 'fooldal' });
    await sikeresFeltoltes();
    expect(screen.getByRole('button', { name: 'Rendben' })).toBeInTheDocument();
  });

  it('forrás nélkül (pl. a profil „Feltöltöm most” gombja) sem ígér visszatérést egy ajánlathoz', async () => {
    nyit({ code: 'IDENTITY_KYC_REQUIRED' });
    await sikeresFeltoltes();
    expect(screen.getByRole('button', { name: 'Rendben' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vissza az ajánlathoz' })).toBeNull();
  });
});

describe('KycModal — fotó-választás', () => {
  it('érintőképernyőn két gomb: „Fotó készítése” (kamera) és „Választás a galériából”', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({ matches: q.includes('coarse'), media: q, addEventListener() {}, removeEventListener() {} }),
    });
    nyit();
    expect(screen.getByRole('button', { name: /Fotó készítése/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Választás a galériából/ })).toBeInTheDocument();
    const kamera = document.getElementById('kyc-kamera') as HTMLInputElement;
    expect(kamera.getAttribute('capture')).toBe('environment');
  });

  it('egérrel egyetlen „Kép kiválasztása” gomb', () => {
    nyit();
    expect(screen.queryByRole('button', { name: /Fotó készítése/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Kép kiválasztása/ })).toBeInTheDocument();
  });

  it('kiválasztás után bélyegkép-előnézet és „Másik fotó” gomb', () => {
    const eredeti = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:elonezet');
    URL.revokeObjectURL = vi.fn();
    try {
      nyit();
      const input = document.getElementById('kyc-dokumentum') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['x'], 'szemelyi.jpg', { type: 'image/jpeg' })] } });
      const kep = screen.getByRole('img', { name: /okmányfotó előnézete/ }) as HTMLImageElement;
      expect(kep.getAttribute('src')).toBe('blob:elonezet');
      fireEvent.click(screen.getByRole('button', { name: 'Másik fotó' }));
      expect(screen.queryByRole('img', { name: /okmányfotó előnézete/ })).toBeNull();
    } finally {
      URL.createObjectURL = eredeti;
    }
  });
});
