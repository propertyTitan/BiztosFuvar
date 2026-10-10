import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BankkartyasFizetesOldal from '../../app/bankkartyas-fizetes/page';
import { CIB_KARTYALOGOK_KEP } from '@/lib/kartyaLogok';
import { CIB_RESZLETES_TAJEKOZTATO } from '@/lib/cibTajekoztato';

// Az elfogadott kártyák listája EGY konstans (lib/kartyaLogok.ts), és a
// szerződés szerinti végleges lista még tulajdonosi megerősítésre vár. Ha egy
// márka kiesik, a kérdések-válaszok (GYFK) rá vonatkozó állításai (Visa
// Electron, co-branded, Visa Secure) sem maradhatnak bent — ez az őr egy Visa
// nélküli listával méri. (Az alapértelmezett, négymárkás lista a
// cib-kotelezo-feluletek tesztben van lefedve.)
//
// 2026-10-10: a bank kérésére a részletes tájékoztató és a logókép a bank
// RÖGZÍTETT anyaga (szó szerint) — az NEM követi a listát; listaváltozásnál
// a banktól új szöveg és kép kell (lib/kartyaLogok.ts fejléce). A GYFK
// márka-specifikus mondatai továbbra is a listát követik.
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

describe('/bankkartyas-fizetes — a GYFK márka-specifikus állításai a kártyalistát követik', () => {
  it('Visa nélküli listánál a GYFK-ban nincs Visa-állítás, a Mastercard-részek maradnak', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = document.body.textContent || '';
    // GYFK: a Visa Electron-mondat és a Visa Secure-kérdés eltűnik.
    expect(szoveg).not.toMatch(/A Visa Electron kártyák interneten történő használatának/);
    expect(screen.queryByRole('heading', { name: /Visa Secure/ })).toBeNull();
    expect(screen.getByRole('heading', { name: /Mastercard Identity Check/ })).toBeInTheDocument();
    expect(szoveg).toMatch(/co-branded kártyával, amely internetes fizetésre alkalmas Mastercard alapú kártya/);
    expect(szoveg).toMatch(/Mastercard és Maestro kártyával, amennyiben a kártyát kibocsátó bank/);
  });

  it('a banki szöveg és a banki logókép rögzített: nem követi a listát', () => {
    render(<BankkartyasFizetesOldal />);
    expect(screen.getByText(CIB_RESZLETES_TAJEKOZTATO.kartyak.bekezdesek[0])).toBeInTheDocument();
    expect(screen.getByAltText(CIB_KARTYALOGOK_KEP.alt)).toBeInTheDocument();
  });
});
