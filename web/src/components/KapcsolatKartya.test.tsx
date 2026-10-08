// UX Q06: a díj után a hívás és a navigáció egy koppintással elérhető.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import KapcsolatKartya from './KapcsolatKartya';
import SzallitoiNavigacio from './SzallitoiNavigacio';

afterEach(cleanup);

describe('KapcsolatKartya', () => {
  it('teljes szélességű hívógomb tagolt számmal, e-mail, üzenet a chatre', () => {
    render(
      <>
        <KapcsolatKartya
          id="elerhetoseg"
          cimke="A szállító elérhetősége"
          bevezeto="Díj rendezve. Hívd fel a szállítót."
          nev="Szabó Péter"
          telefon="+36305551234"
          email="peter@pelda.hu"
          uzenetCel="uzenetek"
        />
        <div id="uzenetek"><textarea aria-label="Üzenet szövege" /></div>
      </>,
    );
    expect(screen.getByRole('heading', { name: 'A szállító elérhetősége' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Hívás: \+36 30 555 1234/ })).toHaveAttribute('href', 'tel:+36305551234');
    expect(screen.getByRole('link', { name: /peter@pelda\.hu/ })).toHaveAttribute('href', 'mailto:peter@pelda.hu');
    fireEvent.click(screen.getByRole('button', { name: /Üzenet/ }));
    expect(document.activeElement).toBe(screen.getByLabelText('Üzenet szövege'));
  });
});

describe('SzallitoiNavigacio', () => {
  it('felvétel előtt: navigáció a felvételhez (új lapon), Waze, másolás, címzett hívása', () => {
    const iras = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: iras } });
    render(
      <SzallitoiNavigacio
        cel="felvetel"
        cim="Budapest, Váci út 1."
        lat={47.5}
        lng={19.05}
        cimzettTelefon="06301112233"
      />,
    );
    const nav = screen.getByRole('link', { name: /Navigáció a felvételhez/ });
    expect(nav.getAttribute('href')).toContain('destination=47.5,19.05');
    expect(nav).toHaveAttribute('target', '_blank');
    expect(nav.getAttribute('rel')).toContain('noopener');
    expect(screen.getByRole('link', { name: /Waze/ }).getAttribute('href')).toContain('ll=47.5,19.05');
    expect(screen.getByRole('link', { name: /Címzett hívása: \+36 30 111 2233/ })).toHaveAttribute('href', 'tel:+36301112233');
    fireEvent.click(screen.getByRole('button', { name: /Cím másolása/ }));
    expect(iras).toHaveBeenCalledWith('Budapest, Váci út 1.');
  });

  it('úton: navigáció a lerakodáshoz', () => {
    render(<SzallitoiNavigacio cel="lerakodas" cim="Szeged, Kossuth u. 1." lat={46.25} lng={20.14} />);
    expect(screen.getByRole('link', { name: /Navigáció a lerakodáshoz/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Címzett hívása/ })).toBeNull();
  });
});
