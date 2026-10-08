// =====================================================================
//  JOGI OLDALAK — A KÓDHOZ IGAZÍTOTT SZÖVEG ÉS AZ OLVASHATÓSÁG
//  (UX-kör A4 + A26, 2026-10-08)
//
//  A4: az ÁSZF szerint a visszalépő szállító „Trust Score értéke csökken",
//  az adatkezelési tájékoztató szerint a pontszám vitákból és lemondásokból
//  is számolódik, és „a profilodon és az ajánlataid mellett" látszik. A kód
//  ezzel szemben vitát és lemondást nem vesz figyelembe, a pontszám csak az
//  adminban látszik, az ajánlatok pedig KIZÁRÓLAG ár szerint rendeződnek —
//  amit az ÁSZF sehol nem írt le (P2B-rendelet 5. cikk). Egy hatósági
//  vizsgálat pont az ilyen, kódból ellenőrizhető ellentmondást keresi.
//
//  A26: a ~23 000 px-es dokumentumokhoz nem volt tartalomjegyzék, a sütik
//  táblázatának „Élettartam" oszlopa mobilon levágódott, és az ÁSZF
//  hatálydátuma régebbi volt, mint az utolsó tartalmi módosítása.
// =====================================================================
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import AszfPage from '../../app/aszf/page';
import AdatkezelesPage from '../../app/adatkezeles/page';

const normal = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

/** Egy fejezet szövege: a h2-től a következő h2-ig. */
function fejezet(container: HTMLElement, id: string): string {
  const cim = container.querySelector(`h2#${id}`);
  expect(cim, `nincs h2#${id}`).not.toBeNull();
  const reszek = [normal(cim!.textContent)];
  let el = cim!.nextElementSibling;
  while (el && el.tagName !== 'H2') { reszek.push(normal(el.textContent)); el = el.nextElementSibling; }
  return reszek.join(' ');
}

describe('ÁSZF — a Trust Score és a rangsor a kód szerint (A4)', () => {
  it('a rangsorolás leírása (P2B 5. cikk): ajánlatok ár szerint, fizetett kiemelés nincs', () => {
    const { container } = render(<AszfPage />);
    const ketto = fejezet(container, 'pont-2');
    expect(ketto).toContain('a fuvardíj szerint növekvő sorrendben');
    expect(ketto).toContain('a feladás ideje szerint');
    expect(ketto).toContain('a felvételi ponttól mért távolság szerint');
    expect(ketto).toContain('Fizetett kiemelés nincs');
  });

  it('a Trust Score csak a változásnaplóban szerepel — a szabályokban nem', () => {
    const { container } = render(<AszfPage />);
    for (const id of ['pont-5', 'pont-7', 'pont-10', 'pont-11']) {
      expect(fejezet(container, id), id).not.toMatch(/Trust Score/);
    }
    expect(fejezet(container, 'pont-5')).toContain('Ismételt, indokolatlan visszalépés esetén a Szolgáltató a Sofőri fiókot felfüggesztheti');
  });

  it('a hatálydátum az utolsó tartalmi módosításé, és van változásnapló', () => {
    const { container } = render(<AszfPage />);
    const t = normal(container.textContent);
    expect(t).toContain('Hatályos: 2026. október 8-tól');
    expect(t).toMatch(/Változások\s*2026\. október 8\.:/);
  });

  it('a díjsávok egységes ezres tagolással (nem „1.000 Ft")', () => {
    const { container } = render(<AszfPage />);
    const negy = fejezet(container, 'pont-4');
    expect(negy).toContain('50 000 Ft fuvardíj felett: 1 000 Ft');
    expect(negy).not.toMatch(/\d\.000/);
  });
});

describe('Adatkezelési tájékoztató — a Trust Score a kód szerint (A4)', () => {
  it('belső, nem látszik a felületen, és a sorrendet nem befolyásolja', () => {
    const { container } = render(<AdatkezelesPage />);
    const hat = fejezet(container, 'automatizalt-dontes');
    expect(hat).toContain('Jelenleg nem jelenik meg a felületen');
    expect(hat).toContain('nem befolyásolja az ajánlatok és a fuvarok sorrendjét');
    expect(hat, 'a kód vitát és lemondást NEM számol be').not.toMatch(/viták és lemondások/);
    expect(hat).not.toMatch(/a profilodon és az ajánlataid mellett/);
  });
});

describe('olvashatóság (A26)', () => {
  for (const [nev, Oldal] of [['ÁSZF', AszfPage], ['Adatkezelési tájékoztató', AdatkezelesPage]] as const) {
    it(`${nev}: tartalomjegyzék, és minden bejegyzése létező fejezetre mutat`, () => {
      const { container } = render(<Oldal />);
      const nav = container.querySelector('nav[aria-label="Tartalomjegyzék"]');
      expect(nav).not.toBeNull();
      expect(nav!.querySelector('details')).not.toBeNull();
      const linkek = [...nav!.querySelectorAll('a')].map((a) => a.getAttribute('href')!);
      expect(linkek.length).toBeGreaterThan(8);
      for (const href of linkek) {
        expect(container.querySelector(`h2${href}`), `${nev}: ${href} nem h2-re mutat`).not.toBeNull();
      }
      // Minden számozott fejezet szerepel a jegyzékben.
      expect(linkek.length).toBe(container.querySelectorAll('h2[id]').length);
      expect(container.querySelector('a[href="#dokumentum-teteje"]')).not.toBeNull();
      expect(container.querySelector('h1#dokumentum-teteje')).not.toBeNull();
    });
  }

  it('a sütik táblázata görgethető, fókuszálható régióban (mobilon nem vágódik le)', () => {
    const { container } = render(<AdatkezelesPage />);
    const tabla = container.querySelector('table')!;
    const regio = tabla.closest('[role="region"]');
    expect(regio).not.toBeNull();
    expect(regio).toHaveClass('jogi-tablazat');
    expect(regio).toHaveAttribute('tabindex', '0');
    expect(regio).toHaveAttribute('aria-label');
    const css = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.jogi-tablazat \{\s*overflow-x: auto;/);
  });

  it('a tájékoztató a telepítő sáv új tárolóit is felsorolja', () => {
    const { container } = render(<AdatkezelesPage />);
    const t = normal(container.textContent);
    for (const kulcs of ['gofuvar_install_dismissed_at', 'gofuvar_install_visits', 'gofuvar_install_eligible', 'gofuvar_install_session']) {
      expect(t).toContain(kulcs);
    }
  });
});
