// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MapCollapse from './MapCollapse';

// MapCollapse őr (2026-09-11, B2): mobilon összecsukva indul, gombbal nyílik;
// asztalon nyitva, gomb nélkül.
function matchMediaMock(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches, media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('MapCollapse', () => {
  it('mobilon összecsukva indul, a gomb megnyitja és bezárja', () => {
    matchMediaMock(true);
    render(<MapCollapse><div data-testid="terkep">TÉRKÉP</div></MapCollapse>);
    expect(screen.queryByTestId('terkep'), 'mobilon a térkép azonnal renderelt — a CTA lecsúszik').toBeNull();
    const gomb = screen.getByRole('button', { name: /Térkép megjelenítése/ });
    expect(gomb.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(gomb);
    expect(screen.getByTestId('terkep')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Térkép elrejtése/ }));
    expect(screen.queryByTestId('terkep')).toBeNull();
  });

  it('asztalon nyitva van, gomb nélkül', () => {
    matchMediaMock(false);
    render(<MapCollapse><div data-testid="terkep">TÉRKÉP</div></MapCollapse>);
    expect(screen.getByTestId('terkep')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// D3 (2026-09-13): az ELSŐ render (SSR / effekt előtt) NEM mountolja a
// térképet — eddig nyitva indult, mobilon betöltötte a Maps scriptet + a
// pozíció-kérést + a socket-szobát, majd az effekt összecsukta.
import { renderToString } from 'react-dom/server';
describe('MapCollapse — első render', () => {
  it('a szerver-render (effekt előtt) nem tartalmazza a térképet', () => {
    const html = renderToString(<MapCollapse><div data-testid="terkep">TÉRKÉP-GYEREK</div></MapCollapse>);
    expect(html, 'az első render nyitva volt — mobilon hiába töltött a térkép').not.toContain('TÉRKÉP-GYEREK');
  });
});
