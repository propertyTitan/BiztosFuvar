import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import SiteFooter from './SiteFooter';
import CibFizetesInfo from './CibFizetesInfo';
import BankkartyasFizetesOldal from '../../app/bankkartyas-fizetes/page';
import { CIB_KARTYALOGOK_KEP } from '@/lib/kartyaLogok';
import { CIB_ROVID_TAJEKOZTATO } from '@/lib/cibTajekoztato';
import { bankiMondatokNelkul } from '../../e2e/szovegor-banki-kivetel';

// A CIB banki átvételi teszt NEM csak technikai (Fejlesztési javaslatok —
// Tesztelési szempontok): a logók, a „Kártyás fizetés szolgáltatója:"
// felirat, az „Elfogadott kártyák" sor, a tájékoztató-link, a kereskedő
// elérhetősége (adószám, székhely, telefon, e-mail) és az országnév miatt is
// bukhat. Ez az őr a felület SZÖVEGÉT nézi, nem a forrást.
//
// 2026-10-10 (a bank írásos kérése a honlap-teszt után): a logók helyén a
// bank EGYBEN szerkesztett logóképe áll (CibKartyaLogok), a tájékoztató a
// bank szövege szó szerint (lib/cibTajekoztato.ts) — az őrök ehhez igazodnak.
const KEP_ALT = CIB_KARTYALOGOK_KEP.alt;

const KERESKEDO = [
  'Tiszta Hód Kft.',
  '6800 Hódmezővásárhely, Szántó Kovács János utca 144.',
  '06-09-020646',
  '24750792-2-06',
  '+36 20 397 9223',
  'info@gofuvar.hu',
];

describe('lábléc: a banki teszt kötelező elemei', () => {
  it('a banki logókép a „Kártyás fizetés szolgáltatója:" felirattal, a tájékoztatóra linkelve', () => {
    render(<SiteFooter />);
    const lablec = screen.getByRole('contentinfo');
    expect(within(lablec).getByText('Kártyás fizetés szolgáltatója:')).toBeInTheDocument();
    const logo = within(lablec).getByAltText(KEP_ALT);
    expect(logo.closest('a')).toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(logo.getAttribute('src')).toBe('/cib/CIB_es_kartyalogok_85px_hrz_HU.png');
  });

  it('„Elfogadott kártyák": a kártyalogók a banki képen, külön logó nincs', () => {
    render(<SiteFooter />);
    const lablec = screen.getByRole('contentinfo');
    expect(within(lablec).getByText('Elfogadott kártyák')).toBeInTheDocument();
    for (const marka of ['Visa', 'V Pay', 'Mastercard', 'Maestro']) {
      expect(KEP_ALT).toContain(marka);
      expect(within(lablec).queryByAltText(marka)).toBeNull();
    }
    expect(lablec.querySelectorAll('img')).toHaveLength(1);
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
    expect(screen.getByAltText(KEP_ALT).closest('a')).toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(screen.getByText('Elfogadott kártyák')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bankkártyás fizetés' })).toHaveAttribute('href', '/bankkartyas-fizetes');
    // A fizetési kártyán a nyilatkozat azonos nevű linkjével azonos célra
    // mutat: a tájékoztató CIB-szakaszára (2026-10-01, WCAG 2.4.4).
    expect(screen.getByRole('link', { name: 'Adatkezelési tájékoztató' })).toHaveAttribute('href', '/adatkezeles#cib-kartyas-fizetes');
    expect(screen.getByText('A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)')).toBeInTheDocument();
    // 2026-10-10: a saját „kártyaadataidat…" mondat helyén a bank rövid
    // tájékoztatója áll, szó szerint.
    expect(screen.getByText(CIB_ROVID_TAJEKOZTATO.bekezdesek[0])).toBeInTheDocument();
    expect(screen.queryByText(/A kártyaadataidat kizárólag/)).toBeNull();
  });
});

describe('/bankkartyas-fizetes — a CIB vásárlói tájékoztatója GoFuvarra kitöltve', () => {
  it('a bank tájékoztatójának részei megvannak, a sablon-helyőrzők nincsenek', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = document.body.textContent || '';
    expect(screen.getByRole('heading', { level: 1, name: /Bankkártyás fizetés/ })).toBeInTheDocument();
    for (const resz of [
      /kapcsolatfelvételi díj/, /256 bites titkosító kulccsal/, /Elfogadott kártyák/, /Fizetés lépései/,
      /„Vissza\/Back”/, /„Frissítés\/Refresh”/, /számlavezető bank/, /tranzakcióazonosító/, /engedélyszám/,
      /Kártya jellegű hiba/, /Számla jellegű hiba/, /Kapcsolati jellegű hiba/, /Technikai jellegű hiba/,
      /Mit jelent a foglalás/, /CVC2\/CVV2/, /Visa Secure/, /Mastercard Identity Check/,
    ]) {
      expect(szoveg, String(resz)).toMatch(resz);
    }
    // A bank belső kitöltési megjegyzése és a sablon-szavak nem maradhatnak bent.
    expect(szoveg).not.toMatch(/Webáruház/i);
    expect(szoveg).not.toMatch(/sárgával kiemelt/i);
    expect(szoveg).not.toMatch(/áru\/szolgáltatás/);
    // 2026-10-10: a VeriSign-mondat a BANK szövege (a bank tanúsítványáról
    // szól, szó szerint kötelező); saját VeriSign-/Norton-LOGÓT viszont nem
    // teszünk ki — olyan tanúsítványunk nincs.
    expect(screen.queryByAltText(/VeriSign|Norton/i)).toBeNull();
    // Szövegszabály: a bank által szó szerint előírt mondat (és csak az)
    // kivétel — ugyanaz a lista, amit a böngészős szövegőr használ.
    expect(bankiMondatokNelkul('/bankkartyas-fizetes', szoveg.replace(/\s+/g, ' '))).not.toMatch(/biztonságos\s+fizetés/i);
    expect(szoveg).not.toMatch(/\blicit/i);
  });

  it('a kereskedő adatai, az ország és a kötelező linkek', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = document.body.textContent || '';
    for (const adat of KERESKEDO) expect(szoveg).toContain(adat);
    expect(szoveg).toContain('A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)');
    expect(screen.getByRole('link', { name: 'Adatkezelési tájékoztató' })).toHaveAttribute('href', '/adatkezeles');
    expect(screen.getAllByRole('link', { name: /ÁSZF|Általános Szerződési Feltételek/ })[0]).toHaveAttribute('href', '/aszf');
    // A banki logókép ezen az oldalon a bank honlapjára visz, új lapon, noopenerrel.
    const cib = screen.getByAltText(KEP_ALT).closest('a');
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
  // 2026-10-10: a „Fizetés lépései" a bank szövege szó szerint (nyilatkozatot
  // nem említ) — a két kötelező nyilatkozatot „A GoFuvar kiegészítése" nevezi meg.
  it('„A GoFuvar kiegészítése" mindkét kötelező nyilatkozatot megnevezi', () => {
    render(<BankkartyasFizetesOldal />);
    const kieg = screen.getByTestId('gofuvar-kiegeszites');
    expect(kieg.textContent).toMatch(/két nyilatkozatot/);
    expect(kieg.textContent).toMatch(/azonnali teljesítés/);
    expect(kieg.textContent).toMatch(/CIB Bank[^.]*adattovábbítás/);
    expect(within(kieg).getByRole('link', { name: /Adatkezelési tájékoztató/ }))
      .toHaveAttribute('href', '/adatkezeles#cib-kartyas-fizetes');
  });

  it('címsor-hierarchia: a csoportok h3-ak, a kérdések alattuk h4-ek', () => {
    render(<BankkartyasFizetesOldal />);
    expect(screen.getByRole('heading', { level: 3, name: /Kártyaelfogadás/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /Milyen típusú kártyákkal lehet fizetni/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 3, name: /Milyen típusú kártyákkal lehet fizetni/ })).toBeNull();
  });

  it('a banki logóképek a nyilvános /cib/ mappában vannak, valódi PNG-ként (dokumentum nem)', () => {
    const mappa = path.join(process.cwd(), 'public', 'cib');
    for (const f of ['CIB_es_kartyalogok_85px_hrz_HU.png', 'CIB_es_kartyalogok_85px_vrt_HU.png']) {
      const b = readFileSync(path.join(mappa, f));
      expect(b.subarray(0, 8).toString('hex'), f).toBe('89504e470d0a1a0a');
    }
    // A régi, márkánként külön logók és a banki dokumentum nincs a mappában.
    expect(readdirSync(mappa).filter((f) => !f.endsWith('.png')), 'nem PNG a /cib/ alatt').toEqual([]);
  });
});
