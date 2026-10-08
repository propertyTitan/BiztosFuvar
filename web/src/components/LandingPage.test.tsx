// =====================================================================
//  FŐOLDAL ŐR — UX-kör (2026-10-08)
//
//  A főoldal a legtöbbet olvasott szöveg: ami itt nem igaz vagy nem látszik,
//  az a konverziót és a közvetítői státuszt (ÁSZF 5.2) is gyengíti. Ez a fájl
//  a javított állapotot tartja — a régi oldalon mind piros:
//   - Q1: a díj összege már a hero-ban látszik,
//   - Q2/Q3: a CTA-k viszik a szándékot (feladó → új fuvar, szállító → szállító mód),
//   - Q4: konkrét tárgy-chipek a meglévő landingekre,
//   - Q5: a ma is igaz bizalmi elemek elöl, a „Hamarosan" funkciók a rács után,
//   - Q10: korai szállítói bejárat + gomb a szerepkör-kártyákon,
//   - A9/A19: nincs „24/7 AI segéd", „biztonságos fuvar", „kifizetésig",
//     és a kód-mondat nem a „feladó" kódját állítja,
//   - Q12/A19: a makett „Illusztráció", valós árakkal és díjsorral.
// =====================================================================
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LandingPage from './LandingPage';

vi.mock('@/lib/socket', () => ({ disconnectSocket: vi.fn(), refreshSocketAuth: vi.fn() }));

const normal = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

beforeEach(() => {
  localStorage.clear();
});

function oldalSzoveg(container: HTMLElement) {
  return normal(container.textContent);
}

describe('a főoldal hero-ja', () => {
  it('a díj összege már a hero-ban látszik (Q1)', () => {
    const { container } = render(<LandingPage />);
    expect(oldalSzoveg(container)).toContain('500 Ft díj — csak ha szállítót választasz (50 000 Ft feletti fuvardíjnál 1 000 Ft)');
    expect(oldalSzoveg(container)).toContain('A fuvardíjat közvetlenül a szállítónak fizeted — készpénzben vagy átutalással, ahogy megegyeztek.');
  });

  it('a feladói CTA a regisztráció után az új fuvar űrlapjára visz (Q2)', () => {
    render(<LandingPage />);
    const cta = screen.getAllByRole('link', { name: /Adj fel egy fuvart/ })[0];
    const url = new URL(cta.getAttribute('href')!, 'https://x.hu');
    expect(url.pathname).toBe('/bejelentkezes');
    expect(url.searchParams.get('next')).toBe('/dashboard/uj-fuvar');
  });

  it('konkrét tárgy-chipek a meglévő landingekre (Q4)', () => {
    render(<LandingPage />);
    const lista = screen.getByRole('list', { name: 'Mit szállíttatnál?' });
    const hrefek = within(lista).getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefek).toEqual(['/butorszallitas', '/ikea-behozatal', '/marketplace-elhozas', '/koltoztetes', '/nagygep-szallitas']);
  });

  it('korai szállítói bejárat a hero alatt (Q10)', () => {
    render(<LandingPage />);
    expect(screen.getByRole('link', { name: /Szállító vagy\? Így teszed pénzzé az utaidat/ }))
      .toHaveAttribute('href', '/soforoknek');
  });
});

describe('a bizalmi blokk és a szerepkörök', () => {
  it('a ma is igaz elemek elöl, a „Hamarosan" a rács után (Q5)', () => {
    const { container } = render(<LandingPage />);
    const t = oldalSzoveg(container);
    const szemelyazonositott = t.indexOf('Személyazonosított szállítók');
    const ujravalasztas = t.indexOf('Díjmentes újraválasztás');
    const gps = t.indexOf('Élő GPS követés');
    expect(szemelyazonositott).toBeGreaterThan(-1);
    expect(ujravalasztas).toBeGreaterThan(szemelyazonositott);
    expect(gps, 'a még nem élő GPS a ma is igaz elemek UTÁN jöjjön').toBeGreaterThan(ujravalasztas);
    // Szövegőr (13-as spec): az élő GPS után 40 karakteren belül „érkez"/„hamarosan".
    expect(t).toMatch(/Élő GPS követés.{0,40}érkez/);
  });

  it('a szerepkör-kártyák nem zsákutcák: gomb a szándékkal (Q10)', () => {
    render(<LandingPage />);
    const feladas = screen.getAllByRole('link', { name: /Fuvart adok fel/ });
    expect(feladas.length).toBeGreaterThan(0);
    for (const a of feladas) {
      expect(new URL(a.getAttribute('href')!, 'https://x.hu').searchParams.get('next')).toBe('/dashboard/uj-fuvar');
    }
    const szallito = screen.getByRole('link', { name: /Szállítóként kezdem/ });
    expect(new URL(szallito.getAttribute('href')!, 'https://x.hu').searchParams.get('szerep')).toBe('szallito');
    expect(screen.getByRole('link', { name: /Szállítóként csatlakozom/ })).toBeInTheDocument();
  });
});

describe('a főoldal szövege csak azt állítja, ami igaz (A9, A19)', () => {
  it('nincs elérhetetlen vagy félrevezető ígéret', () => {
    const { container } = render(<LandingPage />);
    const t = oldalSzoveg(container);
    expect(t, 'az AI-segéd belépéshez kötött — a látogatónak nem ígérhetjük').not.toMatch(/24\/7/);
    expect(t).not.toMatch(/biztonságos fuvar/i);
    expect(t, 'escrow-maradvány: a platform a fuvardíjhoz nem nyúl').not.toMatch(/kifizetésig/);
    expect(t, 'ha van címzett, az ő kódja zárja a fuvart').not.toMatch(/feladó 6 jegyű kódját/);
    expect(t).toContain('az átvevő 6 jegyű kódját');
    expect(t).toContain('Ha más veszi át, a címzett a felvételkor SMS-ben kapja');
    expect(t).not.toMatch(/Kezdj el szállítani ma/);
  });

  it('a makett „Illusztráció", kitalált fuvarszám nélkül, valós árakkal és díjsorral (Q12)', () => {
    const { container } = render(<LandingPage />);
    const t = oldalSzoveg(container);
    expect(t).toContain('Illusztráció — fiktív szállítók és árak');
    expect(t, 'egy még el nem indult platformon a kitalált forgalom félrevezető').not.toMatch(/\d+ fuvar\b/);
    expect(t).toContain('Kapcsolatfelvételi díj: 500 Ft — csak elfogadáskor');
    for (const ar of ['16 500 Ft', '18 000 Ft', '19 500 Ft']) expect(t).toContain(ar);
    expect(t).not.toMatch(/(?<!\d)(8 900|9 500|10 200) Ft/);
  });
});
