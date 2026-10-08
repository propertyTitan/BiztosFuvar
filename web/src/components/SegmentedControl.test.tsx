// UX A29 (2026-10-08): a szegmens-kapcsolók állapota hallható legyen —
// rádiócsoport, aria-checked, nyílbillentyűk, egyetlen Tab-megálló.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SegmentedControl from './SegmentedControl';

afterEach(cleanup);

function Proba({ onValtozas = () => {} }: { onValtozas?: (v: string) => void }) {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return (
    <>
      <div id="cimke">Fiók típusa</div>
      <SegmentedControl
        cimkeId="cimke"
        ertek={v}
        onValtozas={(x) => { setV(x); onValtozas(x); }}
        opciok={[
          { ertek: 'a', felirat: 'Első' },
          { ertek: 'b', felirat: 'Második' },
          { ertek: 'c', felirat: 'Harmadik' },
        ]}
      />
    </>
  );
}

describe('SegmentedControl', () => {
  it('rádiócsoport a látható címke nevével, a kiválasztott aria-checked', () => {
    render(<Proba />);
    expect(screen.getByRole('radiogroup', { name: 'Fiók típusa' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Első' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Második' })).toHaveAttribute('aria-checked', 'false');
  });

  it('egy Tab-megálló: csak a kiválasztott fókuszálható Tabbal', () => {
    render(<Proba />);
    expect(screen.getByRole('radio', { name: 'Első' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Második' })).toHaveAttribute('tabindex', '-1');
  });

  it('kattintásra és nyilakkal választ, körbe is ér, a fókusz követi', () => {
    const valt = vi.fn();
    render(<Proba onValtozas={valt} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Második' }));
    expect(screen.getByRole('radio', { name: 'Második' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Második' }), { key: 'ArrowRight' });
    const harmadik = screen.getByRole('radio', { name: 'Harmadik' });
    expect(harmadik).toHaveAttribute('aria-checked', 'true');
    expect(document.activeElement).toBe(harmadik);

    fireEvent.keyDown(harmadik, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Első' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Első' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Harmadik' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Harmadik' }), { key: 'Home' });
    expect(screen.getByRole('radio', { name: 'Első' })).toHaveAttribute('aria-checked', 'true');
    expect(valt).toHaveBeenLastCalledWith('a');
  });
});
