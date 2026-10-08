// UX A14 (2026-10-08): a toast ne takarja a fejlécet és a hibás mezőt, ne
// duplázódjon, és elfogadáskor ne kerüljön három egymásra.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { ToastProvider, useToast, toastSorba, TOAST_MAX, type Toast } from './ToastProvider';
import { ertesitesErreAzOldalraSzol } from '@/lib/ertesitesek';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const t = (id: number, title: string, body?: string, kind: Toast['kind'] = 'info'): Toast => ({ id, kind, title, body });

describe('toastSorba', () => {
  it('azonos tartalom nem jön újra — csak az időzítő indul újra', () => {
    const elozo = [t(1, 'Nézd át az űrlapot', 'x', 'error')];
    const r = toastSorba(elozo, t(2, 'Nézd át az űrlapot', 'x', 'error'));
    expect(r.lista).toBe(elozo);
    expect(r.ismetelt?.id).toBe(1);
  });

  it(`legfeljebb ${TOAST_MAX} látszik, a legrégebbi esik ki`, () => {
    let lista: Toast[] = [];
    for (let i = 1; i <= 4; i += 1) lista = toastSorba(lista, t(i, `C${i}`)).lista;
    expect(lista.map((x) => x.id)).toEqual([3, 4]);
  });
});

function Gomb() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.error('Nézd át az űrlapot', 'A hibás mezők pirosak.')}>hiba</button>
      <button type="button" onClick={() => toast.success('Ajánlat elfogadva', 'Következő lépés.')}>siker</button>
      <button type="button" onClick={() => toast.info('Megegyeztetek', 'A feladó most fizet.')}>info</button>
    </>
  );
}

describe('ToastProvider', () => {
  it('dupla hívásra EGY toast, bezáró gombbal', () => {
    render(<ToastProvider><Gomb /></ToastProvider>);
    fireEvent.click(screen.getByText('hiba'));
    fireEvent.click(screen.getByText('hiba'));
    expect(screen.getAllByText('Nézd át az űrlapot')).toHaveLength(1);
    const bezar = screen.getByRole('button', { name: 'Értesítés bezárása' });
    fireEvent.click(bezar);
    expect(screen.queryByText('Nézd át az űrlapot')).toBeNull();
  });

  it('három különböző toastból kettő látszik', () => {
    render(<ToastProvider><Gomb /></ToastProvider>);
    fireEvent.click(screen.getByText('hiba'));
    fireEvent.click(screen.getByText('siker'));
    fireEvent.click(screen.getByText('info'));
    expect(screen.queryByText('Nézd át az űrlapot')).toBeNull();
    expect(screen.getByText('Ajánlat elfogadva')).toBeInTheDocument();
    expect(screen.getByText('Megegyeztetek')).toBeInTheDocument();
  });

  it('az ismételt toast időzítője újraindul', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Gomb /></ToastProvider>);
    fireEvent.click(screen.getByText('siker'));
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(screen.getByText('siker'));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByText('Ajánlat elfogadva')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.queryByText('Ajánlat elfogadva')).toBeNull();
  });

  it('a sáv a fejléc alatt (asztal) és alul (mobil) ül, nem a fejléc fölött', () => {
    const forras = fs.readFileSync(path.join(__dirname, 'ToastProvider.tsx'), 'utf8');
    expect(forras).toMatch(/\.toast-sav \{[\s\S]*?top: 72px;/);
    expect(forras).toMatch(/@media \(max-width: 640px\) \{[\s\S]*?bottom: calc\(16px \+ env\(safe-area-inset-bottom/);
    // a régi „✓ / ✗ / 🔔" karakter-ikonok helyett lucide
    expect(forras).not.toMatch(/'🔔 '|'✓ '|'✗ '/);
  });
});

describe('ertesitesErreAzOldalraSzol', () => {
  it('a nyitott fuvaroldalra szóló értesítés nem kell toastnak', () => {
    expect(ertesitesErreAzOldalraSzol('/dashboard/fuvar/abc', '/dashboard/fuvar/abc')).toBe(true);
    expect(ertesitesErreAzOldalraSzol('/sofor/fuvar/abc?x=1#chat', '/sofor/fuvar/abc/')).toBe(true);
    expect(ertesitesErreAzOldalraSzol('/dashboard/fuvar/abc', '/')).toBe(false);
    expect(ertesitesErreAzOldalraSzol('/dashboard/fuvar/abc', '/dashboard/fuvar/xyz')).toBe(false);
    expect(ertesitesErreAzOldalraSzol(null, '/')).toBe(false);
    expect(ertesitesErreAzOldalraSzol('https://gonosz.example/', '/')).toBe(false);
  });
});
