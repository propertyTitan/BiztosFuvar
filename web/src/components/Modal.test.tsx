// Közös dialógus-héj (UX-review A29, 2026-10-08): role=dialog, Escape,
// fókuszcsapda, a fókusz visszaadása, és egymásra nyíló ablakoknál csak a
// legfelső reagál.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import Modal from './Modal';

describe('Modal', () => {
  it('role=dialog + aria-modal, a címsor nevezi meg', () => {
    render(<Modal open onClose={vi.fn()} labelledBy="cim"><h2 id="cim">Próba</h2></Modal>);
    const d = screen.getByRole('dialog', { name: 'Próba' });
    expect(d).toHaveAttribute('aria-modal', 'true');
  });

  it('nyitáskor a fókusz az ablakba kerül, záráskor vissza a hívó gombra', () => {
    function Hivo() {
      const [nyitva, setNyitva] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setNyitva(true)}>Megnyitás</button>
          <Modal open={nyitva} onClose={() => setNyitva(false)} ariaLabel="Ablak" closeButton>
            <p>Tartalom</p>
          </Modal>
        </>
      );
    }
    render(<Hivo />);
    const hivo = screen.getByRole('button', { name: 'Megnyitás' });
    hivo.focus();
    fireEvent.click(hivo);
    const d = screen.getByRole('dialog', { name: 'Ablak' });
    expect(d.contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Bezárás' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(hivo);
  });

  it('Tab az utolsó elemről az elsőre ugrik, a háttér nem érhető el', () => {
    render(
      <>
        <button type="button">Háttér</button>
        <Modal open onClose={vi.fn()} ariaLabel="Ablak">
          <button type="button">Első</button>
          <button type="button">Utolsó</button>
        </Modal>
      </>,
    );
    const utolso = screen.getByRole('button', { name: 'Utolsó' });
    utolso.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Első' }));
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(utolso);
  });

  it('egymásra nyíló ablakoknál az Escape csak a legfelsőt zárja', () => {
    const alsoZar = vi.fn();
    const felsoZar = vi.fn();
    render(
      <>
        <Modal open onClose={alsoZar} ariaLabel="Alsó"><p>a</p></Modal>
        <Modal open onClose={felsoZar} ariaLabel="Felső"><p>f</p></Modal>
      </>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(felsoZar).toHaveBeenCalledTimes(1);
    expect(alsoZar).not.toHaveBeenCalled();
  });
});
