import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import SiteFooter from './SiteFooter';
import CibFizetesInfo from './CibFizetesInfo';
import BankkartyasFizetesOldal from '../../app/bankkartyas-fizetes/page';

// A CIB banki átvételi teszt NEM csak technikai (Fejlesztési javaslatok —
// Tesztelési szempontok): a logók, a „Kártyás fizetés szolgáltatója:"
// felirat, az „Elfogadott kártyák" sor, a tájékoztató-link, a kereskedő
// elérhetősége (adószám, székhely, telefon, e-mail) és az országnév miatt is
// bukhat. Ez az őr a felület SZÖVEGÉT nézi, nem a forrást.

const KERESKEDO = [
  'Tiszta Hód Kft.',
  '6800 Hódmezővásárhely, Szántó Kovács János utca 144.',
  '06-09-020646',
  '24750792-2-06',
  '+36 20 397 9223',
  'info@gofuvar.hu',
];

describe('lábléc: a banki teszt kötelező elemei', () => {
  it('CIB-logó a „Kártyás fizetés szolgáltatója:" felirattal, a tájékoztatóra linkelve', () => {
    render(<SiteFooter />);
    const lablec = screen.getByRole('contentinfo');
    expect(within(lablec).getByText('Kártyás fizetés szolgáltatója:')).toBeInTheDocument();
    const logo = within(lablec).getByAltText('CIB Bank');
    expect(logo.closest('a')).toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(logo.getAttribute('src')).toBe('/cib/cib-bank.svg');
  });

  it('„Elfogadott kártyák" logósor', () => {
    render(<SiteFooter />);
    const lablec = screen.getByRole('contentinfo');
    expect(within(lablec).getByText('Elfogadott kártyák')).toBeInTheDocument();
    for (const alt of ['Visa', 'V Pay', 'Mastercard', 'Maestro']) {
      expect(within(lablec).getByAltText(alt)).toBeInTheDocument();
    }
  });

  it('„Bankkártyás fizetés", ÁSZF és „Adatkezelési tájékoztató" link', () => {
    render(<SiteFooter />);
    const lablec = screen.getByRole('contentinfo');
    expect(within(lablec).getByRole('link', { name: 'Bankkártyás fizetés' })).toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(within(lablec).getByRole('link', { name: 'ÁSZF' })).toHaveAttribute('href', '/aszf');
    expect(within(lablec).getByRole('link', { name: 'Adatkezelési tájékoztató' })).toHaveAttribute('href', '/adatkezeles');
  });

  it('„Kapcsolat" link a kereskedő elérhetőségéhez (a banki javaslat szerint)', () => {
    render(<SiteFooter />);
    const lablec = screen.getByRole('contentinfo');
    const link = within(lablec).getByRole('link', { name: 'Kapcsolat' });
    expect(link).toHaveAttribute('href', '#kapcsolat');
    // A cél a láblécben van — minden oldalon létezik.
    const cel = lablec.querySelector('#kapcsolat');
    expect(cel).not.toBeNull();
    expect(cel?.textContent || '').toMatch(/Adószám/);
  });

  it('a kereskedő neve, székhelye (országgal), cégjegyzékszáma, adószáma, telefonja és e-mailje', () => {
    render(<SiteFooter />);
    const szoveg = screen.getByRole('contentinfo').textContent || '';
    for (const adat of KERESKEDO) expect(szoveg).toContain(adat);
    expect(szoveg).toMatch(/Magyarország/);
    expect(szoveg).toMatch(/Cégjegyzékszám/);
    expect(szoveg).toMatch(/Adószám/);
  });
});

describe('fizetési kártya: CibFizetesInfo', () => {
  it('minden kötelező sor és link megvan', () => {
    render(<CibFizetesInfo />);
    expect(screen.getByText('Kártyás fizetés szolgáltatója:')).toBeInTheDocument();
    expect(screen.getByAltText('CIB Bank').closest('a')).toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(screen.getByText('Elfogadott kártyák')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bankkártyás fizetés' })).toHaveAttribute('href', '/bankkartyas-fizetes');
    // A fizetési kártyán a nyilatkozat azonos nevű linkjével azonos célra
    // mutat: a tájékoztató CIB-szakaszára (2026-10-01, WCAG 2.4.4).
    expect(screen.getByRole('link', { name: 'Adatkezelési tájékoztató' })).toHaveAttribute('href', '/adatkezeles#cib-kartyas-fizetes');
    expect(screen.getByText('A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)')).toBeInTheDocument();
    expect(screen.getByText('A kártyaadataidat kizárólag a CIB Bank oldalán adod meg, a GoFuvar nem látja őket.')).toBeInTheDocument();
  });
});

describe('/bankkartyas-fizetes — a CIB vásárlói tájékoztatója GoFuvarra kitöltve', () => {
  it('a bank tájékoztatójának részei megvannak, a sablon-helyőrzők nincsenek', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = document.body.textContent || '';
    expect(screen.getByRole('heading', { level: 1, name: /Bankkártyás fizetés/ })).toBeInTheDocument();
    for (const resz of [
      /kapcsolatfelvételi díj/, /256 bites TLS/, /Elfogadott kártyák/, /A fizetés lépései/,
      /Vissza/, /Frissítés/, /számlavezető bank/, /tranzakcióazonosító/, /engedélyszám/,
      /Kártya jellegű hiba/, /Számla jellegű hiba/, /Kapcsolati jellegű hiba/, /Technikai jellegű hiba/,
      /Mit jelent a foglalás/, /CVC2\/CVV2/, /Visa Secure/, /Mastercard Identity Check/,
    ]) {
      expect(szoveg, String(resz)).toMatch(resz);
    }
    // A bank belső kitöltési megjegyzése és a sablon-szavak nem maradhatnak bent.
    expect(szoveg).not.toMatch(/Webáruház/i);
    expect(szoveg).not.toMatch(/sárgával kiemelt/i);
    expect(szoveg).not.toMatch(/áru\/szolgáltatás/);
    // Olyan tanúsítványra nem hivatkozunk, amivel nem rendelkezünk.
    expect(szoveg).not.toMatch(/VeriSign|Norton/i);
    // Szövegszabály.
    expect(szoveg).not.toMatch(/biztonságos\s+fizetés/i);
    expect(szoveg).not.toMatch(/\blicit/i);
  });

  it('a kereskedő adatai, az ország és a kötelező linkek', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = document.body.textContent || '';
    for (const adat of KERESKEDO) expect(szoveg).toContain(adat);
    expect(szoveg).toContain('A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)');
    expect(screen.getAllByRole('link', { name: /Adatkezelési tájékoztató/ })[0]).toHaveAttribute('href', '/adatkezeles');
    expect(screen.getAllByRole('link', { name: /ÁSZF|Általános Szerződési Feltételek/ })[0]).toHaveAttribute('href', '/aszf');
    // A banki logó ezen az oldalon a bank honlapjára visz, új lapon, noopenerrel.
    const cib = screen.getByAltText('CIB Bank').closest('a');
    expect(cib).toHaveAttribute('href', 'https://www.cib.hu/');
    expect(cib?.getAttribute('rel') || '').toMatch(/noopener/);
  });

  it('panasz, elállás és garancia: az ÁSZF 6. pontjára és a panasz-címre mutat', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = document.body.textContent || '';
    expect(szoveg).toMatch(/ÁSZF[^.]*6\. pont/);
    expect(szoveg).toMatch(/[Ee]lállás/);
    expect(screen.getAllByRole('link', { name: 'panasz@gofuvar.hu' })[0]).toHaveAttribute('href', 'mailto:panasz@gofuvar.hu');
    expect(screen.getByRole('heading', { level: 2, name: /Kapcsolat/ })).toBeInTheDocument();
  });

  // 2026-10-03 (CIB PR-5, lelet 31): a lépések egyetlen nyilatkozatot
  // említettek, a felület CIB-módban kettőt kér (a bank írásos válasza).
  it('a fizetés lépései mindkét kötelező nyilatkozatot megnevezik', () => {
    render(<BankkartyasFizetesOldal />);
    const lepes = screen.getByText(/Fizetés bankkártyával/, { selector: 'li' });
    expect(lepes.textContent).toMatch(/azonnali teljesítés/);
    expect(lepes.textContent).toMatch(/CIB Bank[^.]*adattovábbítás/);
    expect(lepes.textContent).toMatch(/mindkét/);
  });

  it('címsor-hierarchia: a csoportok h3-ak, a kérdések alattuk h4-ek', () => {
    render(<BankkartyasFizetesOldal />);
    expect(screen.getByRole('heading', { level: 3, name: /Kártyaelfogadás/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /Milyen típusú kártyákkal lehet fizetni/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: /Milyen típusú kártyákkal lehet fizetni/ })).toBeNull();
  });

  it('a logók a nyilvános /cib/ mappában vannak (dokumentum nem)', () => {
    const mappa = path.join(process.cwd(), 'public', 'cib');
    for (const f of ['cib-bank.svg', 'visa.svg', 'vpay.svg', 'mastercard.svg', 'maestro.svg']) {
      const tartalom = readFileSync(path.join(mappa, f), 'utf8');
      expect(tartalom, f).toMatch(/<svg/);
      expect(tartalom, `${f}: szkript az SVG-ben`).not.toMatch(/<script/i);
    }
  });
});
