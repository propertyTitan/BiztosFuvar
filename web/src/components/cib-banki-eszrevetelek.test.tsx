import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import CibKartyaLogok from './CibKartyaLogok';
import CibFizetesInfo from './CibFizetesInfo';
import SiteFooter from './SiteFooter';
import BankkartyasFizetesOldal from '../../app/bankkartyas-fizetes/page';
import { CIB_KARTYALOGOK_KEP as KEP } from '@/lib/kartyaLogok';
import { CIB_RESZLETES_TAJEKOZTATO, CIB_ROVID_TAJEKOZTATO, GOFUVAR_KIEGESZITES } from '@/lib/cibTajekoztato';
import { BANKI_ELOIRT_MONDATOK, bankiMondatokNelkul } from '../../e2e/szovegor-banki-kivetel';

// =====================================================================
//  A CIB BANK ÉSZREVÉTELEI A HONLAP-TESZT UTÁN (2026-10-10)
//   (1) „A banki és kártyatársasági logók nem megfelelően szerepelnek az
//       oldalon" → a bank egyben szerkesztett logóképe
//       (CIB_es_kartyalogok_85px_hrz_HU.png / …_vrt_HU.png) MINDHÁROM
//       felületen: lábléc, fizetési kártya, /bankkartyas-fizetes;
//   (2) „A banki fizetési tájékoztató nem megfelelő" → a bank
//       eCom_CIB.fiz.taj_HU szövege szó szerint (a betűre egyezést a
//       lib/cibTajekoztato.test.ts méri), a GoFuvar saját mondatai külön.
// =====================================================================

const olvas = (rel: string) => readFileSync(path.join(process.cwd(), rel));

/** A PNG IHDR-jéből a valódi méret. */
function pngMeret(rel: string): { szel: number; mag: number } {
  const b = olvas(rel);
  expect(b.subarray(0, 8).toString('hex'), `${rel}: nem PNG`).toBe('89504e470d0a1a0a');
  return { szel: b.readUInt32BE(16), mag: b.readUInt32BE(20) };
}

/** A banki logókép MINDKÉT változata ott van-e a tárolóban, és más kép nincs. */
function bankiKepetMutat(tarolo: HTMLElement, cel: string) {
  const kepek = tarolo.querySelectorAll('img');
  expect(kepek, 'a banki képen kívül más logó/kép nem lehet').toHaveLength(1);
  const img = within(tarolo).getByAltText(KEP.alt);
  expect(img).toHaveAttribute('src', KEP.vizszintes.src);
  const forras = img.closest('picture')?.querySelector('source');
  expect(forras, 'hiányzik a keskeny képernyős (függőleges) változat').not.toBeNull();
  expect(forras).toHaveAttribute('srcset', KEP.fuggoleges.src);
  expect(forras).toHaveAttribute('media', '(max-width: 560px)');
  expect(img.closest('a')).toHaveAttribute('href', cel);
}

describe('(1) a banki logókép — a bank által megnevezett fájlok', () => {
  it('a fájlok a bank nevén, változatlan méretben vannak a /cib/ alatt', () => {
    expect(KEP.vizszintes.src).toBe('/cib/CIB_es_kartyalogok_85px_hrz_HU.png');
    expect(KEP.fuggoleges.src).toBe('/cib/CIB_es_kartyalogok_85px_vrt_HU.png');
    expect(pngMeret('public/cib/CIB_es_kartyalogok_85px_hrz_HU.png')).toEqual({ szel: 971, mag: 85 });
    expect(pngMeret('public/cib/CIB_es_kartyalogok_85px_vrt_HU.png')).toEqual({ szel: 623, mag: 170 });
    for (const v of [KEP.vizszintes, KEP.fuggoleges]) {
      expect(pngMeret(`public${v.src}`)).toEqual({ szel: v.forrasSzel, mag: v.forrasMag });
      // Nincs felnagyítás, és a megjelenítési arány a forrásé (±1 px).
      expect(v.mag).toBeLessThanOrEqual(v.forrasMag);
      expect(v.szel).toBeLessThanOrEqual(v.forrasSzel);
      expect(Math.abs(v.szel * v.forrasMag / v.forrasSzel - v.mag)).toBeLessThanOrEqual(1);
    }
    // Asztalon 40–48 px magas sáv.
    expect(KEP.vizszintes.mag).toBeGreaterThanOrEqual(40);
    expect(KEP.vizszintes.mag).toBeLessThanOrEqual(48);
  });

  it('az alt szöveg mindent felsorol, ami a képen van', () => {
    expect(KEP.alt).toBe(
      'CIB Bank — elfogadott kártyák: Mastercard, Maestro, Visa, V Pay; Mastercard ID Check, Visa Secure',
    );
  });

  it('a komponens: <picture> 560 px alatt függőleges, fölötte vízszintes; méret-attribútumok (nincs ugrás)', () => {
    render(<CibKartyaLogok />);
    const doboz = screen.getByTestId('cib-kartyalogok');
    bankiKepetMutat(doboz, '/bankkartyas-fizetes');
    const img = screen.getByAltText(KEP.alt);
    expect(img).toHaveAttribute('width', String(KEP.vizszintes.szel));
    expect(img).toHaveAttribute('height', String(KEP.vizszintes.mag));
    const forras = img.closest('picture')!.querySelector('source')!;
    expect(forras).toHaveAttribute('width', String(KEP.fuggoleges.szel));
    expect(forras).toHaveAttribute('height', String(KEP.fuggoleges.mag));
    // A banki kísérőszövegek („Fejlesztési javaslatok") megmaradnak.
    expect(within(doboz).getByText('Kártyás fizetés szolgáltatója:')).toBeInTheDocument();
    expect(within(doboz).getByText('Elfogadott kártyák')).toBeInTheDocument();
  });

  it('a tájékoztató oldalon a kép a bank honlapjára visz (új lapon, noopenerrel)', () => {
    render(<CibKartyaLogok cel="cib" />);
    const link = screen.getByAltText(KEP.alt).closest('a')!;
    expect(link).toHaveAttribute('href', 'https://www.cib.hu/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel') || '').toMatch(/noopener/);
  });

  it('a CSS ugyanazt a töréspontot használja, fehér chipen, a források képarányával', () => {
    const css = olvas('src/components/CibKartyaLogok.module.css').toString('utf8');
    expect(css).toContain(`@media ${KEP.keskenyMedia}`);
    expect(css).toMatch(/background:\s*#ffffff/);
    expect(css).toMatch(/aspect-ratio:\s*971 \/ 85/);
    expect(css).toMatch(/aspect-ratio:\s*623 \/ 170/);
    expect(css).toMatch(/max-width:\s*100%/);
  });

  it('a lábléc a banki képet mutatja (a tájékoztatóra linkelve), lusta betöltéssel', () => {
    render(<SiteFooter />);
    bankiKepetMutat(screen.getByRole('contentinfo'), '/bankkartyas-fizetes');
    // A lábléc minden oldalon ott van — a kép csak a közelébe görgetve töltődjön.
    expect(screen.getByAltText(KEP.alt)).toHaveAttribute('loading', 'lazy');
  });

  it('a fizetési kártya banki blokkja a banki képet mutatja (a tájékoztatóra linkelve)', () => {
    render(<CibFizetesInfo />);
    bankiKepetMutat(screen.getByTestId('cib-fizetes-info'), '/bankkartyas-fizetes');
  });

  it('a /bankkartyas-fizetes oldal a banki képet mutatja (a bank honlapjára linkelve), a 3DS-logók külön nincsenek', () => {
    render(<BankkartyasFizetesOldal />);
    bankiKepetMutat(document.body, 'https://www.cib.hu/');
    // Az oldal tetején áll — azonnal töltődik.
    expect(screen.getByAltText(KEP.alt)).toHaveAttribute('loading', 'eager');
    expect(screen.queryByAltText('Visa Secure')).toBeNull();
    expect(screen.queryByAltText('Mastercard Identity Check')).toBeNull();
  });
});

describe('(2) a fizetési kártya: a bank rövid tájékoztatója szó szerint', () => {
  it('a rövid tájékoztató és a „Kérjük, olvassa el…" link a /bankkartyas-fizetes oldalra', () => {
    render(<CibFizetesInfo />);
    const rovid = screen.getByTestId('cib-rovid-tajekoztato');
    expect(rovid.textContent).toBe(
      `${CIB_ROVID_TAJEKOZTATO.bekezdesek[0]}${CIB_ROVID_TAJEKOZTATO.bekezdesek[1]} ${CIB_ROVID_TAJEKOZTATO.reszletesLink}`,
    );
    expect(within(rovid).getByRole('link', { name: 'Kérjük, olvassa el részletes tájékoztatónkat!' }))
      .toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(rovid.textContent).toContain('A GoFuvar a CIB Bank által biztosított biztonságos bankkártyás fizetési megoldást nyújtja vásárlóinak.');
    expect(rovid.textContent).toContain('A kapcsolatfelvételi szolgáltatás ellenértéke, a kifizetett összeg azonnal zárolásra kerül kártyaszámláján.');
    expect(rovid.textContent).not.toMatch(/Webáruház|áru\/szolgáltatás/);
  });

  it('a banki kötelező elemek megmaradnak: országsor, „Bankkártyás fizetés" és „Adatkezelési tájékoztató" link', () => {
    render(<CibFizetesInfo />);
    expect(screen.getByText('A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Bankkártyás fizetés' })).toHaveAttribute('href', '/bankkartyas-fizetes');
    expect(screen.getByRole('link', { name: 'Adatkezelési tájékoztató' })).toHaveAttribute('href', '/adatkezeles#cib-kartyas-fizetes');
  });
});

describe('(2) /bankkartyas-fizetes: a bank részletes tájékoztatója szó szerint, utána a kiegészítés', () => {
  it('a docx TELJES tartalma a nyilvános oldalon: előbb a rövid tájékoztató (a részletesre mutató linkkel), utána a részletes', () => {
    // 2026-10-10: a rövid rész eddig csak a (bejelentkezett) fizetési kártyán állt.
    const { container } = render(<BankkartyasFizetesOldal />);
    const rovid = screen.getByTestId('cib-rovid-tajekoztato');
    expect(rovid.textContent).toContain(
      'A GoFuvar a CIB Bank által biztosított biztonságos bankkártyás fizetési megoldást nyújtja vásárlóinak.',
    );
    expect(rovid.textContent).toContain(
      'A kapcsolatfelvételi szolgáltatás ellenértéke, a kifizetett összeg azonnal zárolásra kerül kártyaszámláján.',
    );
    expect(within(rovid).getByRole('link', { name: 'Kérjük, olvassa el részletes tájékoztatónkat!' }))
      .toHaveAttribute('href', '#reszletes');
    const reszletes = screen.getByTestId('cib-reszletes-tajekoztato');
    expect(reszletes.id).toBe('reszletes');
    // Sorrend: logó → rövid → részletes.
    const html = container.innerHTML;
    expect(html.indexOf('cib-rovid-tajekoztato')).toBeLessThan(html.indexOf('cib-reszletes-tajekoztato'));
  });

  it('a bank kulcsmondatai betűre, a cserélt szavakkal; „Webáruház" nincs', () => {
    render(<BankkartyasFizetesOldal />);
    const bank = screen.getByTestId('cib-reszletes-tajekoztato').textContent || '';
    for (const mondat of [
      'Üdvözöljük a CIB Bank biztonságos, internetes fizetési megoldásával működő GoFuvaron!',
      'Olvassa el a GoFuvar ismertetőjét, a vásárlás kondícióit és a kiszállítás és a fizetés feltételeit!',
      'A VeriSign nevű cég teszi lehetővé a CIB Banknak a 256 bites kulcs használatát, amely segítségével biztosítjuk az TLS alapú titkosítást.',
      'Jelenleg a világ elektronikus kereskedelmének 90%-ában ezt a titkosítási módot alkalmazzák.',
      'A CIB Bank internetes fizetési rendszere a Mastercard/Maestro, a VISA termékcsaládba tartozó VISA és VISA Electron',
      'Ön a GoFuvar oldalán választja ki a kapcsolatfelvételi díjat, melynek összegét bankkártyás fizetéssel kívánja teljesíteni.',
      'A fizetést követően Ön visszatér a GoFuvar oldalára, ahol a tranzakció eredményéről kap visszaigazolást.',
      'a CIB Bank elindítja a Kártyabirtokos számlájának megterhelését az áru vagy szolgáltatás ellenértékével.',
      'Amennyiben Ön nem kerül visszairányításra a fizetőoldalról a GoFuvar oldalára, úgy a tranzakció sikertelennek minősül.',
      'mielőtt visszairányításra kerülne az áruházba, a fizetés sikertelennek minősül.',
      'kérjük, vegye fel a kapcsolatot számlavezető bankjával.',
    ]) {
      expect(bank, mondat).toContain(mondat);
    }
    expect(document.body.textContent || '').not.toMatch(/Webáruház/i);
    expect(document.body.textContent || '').not.toMatch(/sárgával kiemelt/i);
  });

  it('a bank címsorai h2-ként', () => {
    render(<BankkartyasFizetesOldal />);
    for (const cim of ['Mire figyeljen a vásárláskor?', 'A biztonságról', 'Elfogadott kártyák', 'Fizetés lépései']) {
      expect(screen.getByRole('heading', { level: 2, name: cim })).toBeInTheDocument();
    }
  });

  it('„A GoFuvar kiegészítése" a banki szöveg UTÁN, külön keretben, a GYFK ELŐTT', () => {
    render(<BankkartyasFizetesOldal />);
    const logo = screen.getByAltText(KEP.alt);
    const bank = screen.getByTestId('cib-reszletes-tajekoztato');
    const kieg = screen.getByTestId('gofuvar-kiegeszites');
    const gyfk = screen.getByRole('heading', { level: 2, name: 'Kérdések és válaszok' });
    const utana = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(utana(logo, bank)).toBe(true);
    expect(utana(bank, kieg)).toBe(true);
    expect(utana(kieg, gyfk)).toBe(true);
    // Külön keret, saját címsorral — a banki blokkon kívül.
    expect(bank.contains(kieg)).toBe(false);
    expect(within(kieg).getByRole('heading', { level: 2, name: 'A GoFuvar kiegészítése' })).toBeInTheDocument();
    expect(kieg.textContent).toContain(GOFUVAR_KIEGESZITES.visszateres);
    // A banki szöveg a kiegészítés nélkül is teljes, és nem keveredik bele.
    expect(bank.textContent).not.toContain('lekérdezzük a banktól');
  });

  it('a GYFK és a kereskedő adatai megmaradnak', () => {
    render(<BankkartyasFizetesOldal />);
    expect(screen.getByRole('heading', { level: 3, name: /Kártyaelfogadás/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: /Mit jelent a Visa Secure/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /Kapcsolat és a kereskedő adatai/ })).toBeInTheDocument();
    expect(document.body.textContent).toContain('A Kereskedő/Tiszta Hód Kft. székhelyének országa és országkódja: Magyarország (HU)');
  });
});

describe('a szövegőr kivétele: PONTOSAN a bank által előírt mondat, csak ezen az oldalon', () => {
  const TILTAS = /biztonságos\s+fizetés/i; // a 13-as spec GF-024-es szabálya

  it('csak a /bankkartyas-fizetes kapott kivételt, és a mondat betűre a banki szövegben van', () => {
    expect(Object.keys(BANKI_ELOIRT_MONDATOK)).toEqual(['/bankkartyas-fizetes']);
    for (const mondat of BANKI_ELOIRT_MONDATOK['/bankkartyas-fizetes']) {
      expect(CIB_RESZLETES_TAJEKOZTATO.lepesek.pontok as readonly string[]).toContain(mondat);
    }
  });

  it('az oldalon a kivétel NÉLKÜL a tiltás jelezne — vele nem (a kivétel szükséges és elég)', () => {
    render(<BankkartyasFizetesOldal />);
    const szoveg = (document.body.textContent || '').replace(/\s+/g, ' ');
    expect(szoveg).toMatch(TILTAS);
    expect(bankiMondatokNelkul('/bankkartyas-fizetes', szoveg)).not.toMatch(TILTAS);
  });

  it('a kivétel nem takar el más előfordulást, és más oldalon nem hat', () => {
    const mondat = BANKI_ELOIRT_MONDATOK['/bankkartyas-fizetes'][0];
    expect(bankiMondatokNelkul('/bankkartyas-fizetes', `${mondat} Nálunk biztonságos fizetés vár.`)).toMatch(TILTAS);
    expect(bankiMondatokNelkul('/', mondat)).toMatch(TILTAS);
    // Átírt (nem betűre egyező) banki mondat sem élvez kivételt.
    expect(bankiMondatokNelkul('/bankkartyas-fizetes', mondat.replace('Ön átkerül', 'átkerülsz'))).toMatch(TILTAS);
  });

  it('a böngészős szövegőr a kivételt használja, és a szabály + az oldal a listán maradt', () => {
    const spec = olvas('e2e/13-szovegor.spec.ts').toString('utf8');
    expect(spec).toContain("import { bankiMondatokNelkul } from './szovegor-banki-kivetel';");
    expect(spec).toMatch(/bankiMondatokNelkul\(oldal, /);
    expect(spec).toContain('pattern: /biztonságos\\s+fizetés/i');
    expect(spec).toContain("'/bankkartyas-fizetes',");
  });
});
