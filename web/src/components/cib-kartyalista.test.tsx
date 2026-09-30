import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BankkartyasFizetesOldal from '../../app/bankkartyas-fizetes/page';

// Az elfogadott kártyák listája EGY konstans (lib/kartyaLogok.ts), és a
// szerződés szerinti végleges lista még tulajdonosi megerősítésre vár. Ha egy
// márka kiesik, a tájékoztató rá vonatkozó állításai (Visa Electron,
// co-branded, Visa Secure) sem maradhatnak bent — ez az őr egy Visa nélküli
// listával méri. (Az alapértelmezett, négymárkás lista a
// cib-kotelezo-feluletek tesztben van lefedve.)
vi.mock('@/lib/kartyaLogok', async (orig) => {
  const valodi = await orig<typeof import('@/lib/kartyaLogok')>();
  const lista = ['mastercard', 'maestro'] as const;
  return {
    ...valodi,
    ELFOGADOTT_KARTYAK: lista,
    kartyaElfogadva: (id: string) => (lista as readonly string[]).includes(id),
    elfogadottKartyakSzoveg: () => 'Mastercard és Maestro',
  };
});

describe('/bankkartyas-fizetes — a márka-specifikus állítások a kártyalistát követik', () => {
  it('Visa nélküli listánál nincs Visa-állítás, a Mastercard-részek maradnak', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = document.body.textContent || '';
    expect(szoveg).not.toMatch(/Visa Electron/);
    expect(screen.queryByRole('heading', { name: /Visa Secure/ })).toBeNull();
    expect(screen.queryByAltText('Visa')).toBeNull();
    expect(screen.getByRole('heading', { name: /Mastercard Identity Check/ })).toBeInTheDocument();
    expect(szoveg).toMatch(/co-branded kártyával, amely internetes fizetésre alkalmas Mastercard alapú kártya/);
    expect(szoveg).toMatch(/Mastercard és Maestro kártyával fizethetsz/);
  });
});
