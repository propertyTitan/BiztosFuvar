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
import { UJ_FUVAR_PISZKOZAT_ELOTAG } from '@/lib/urlapPiszkozat';

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

/** Egy alpont szövege: a „5.3."-mal kezdődő h3-tól a következő h2/h3-ig. */
function alpont(container: HTMLElement, szam: string): string {
  const cim = [...container.querySelectorAll('h3')].find((h) => normal(h.textContent).startsWith(szam));
  expect(cim, `nincs ${szam} alpont`).toBeTruthy();
  const reszek = [normal(cim!.textContent)];
  let el = cim!.nextElementSibling;
  while (el && el.tagName !== 'H2' && el.tagName !== 'H3') { reszek.push(normal(el.textContent)); el = el.nextElementSibling; }
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
    // A backend az eredeti amount_huf szerint rendez (bids.js), és a
    // visszafuvar/útba eső listát illeszkedés szerint (fix1-review).
    expect(ketto).toContain('egy ellenajánlat a sorrendet nem módosítja');
    expect(ketto).toContain('földrajzi illeszkedés');
    expect(ketto).not.toMatch(/szerint rendez \(/);
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
    // A változásnapló minden érintett pontot megnevez (fix1-review).
    expect(t).toContain('az 5.1., a 7., a 10. és a 11.4. pontból kikerült a „Trust Score”');
    expect(t).toContain('„tartósan rossz értékelések”');
  });

  it('a változásnapló a valódi alpontot nevezi meg (fix2-review): a fotó-átnevezés az 5.3.-ban van', () => {
    const { container } = render(<AszfPage />);
    const t = normal(container.textContent);
    expect(t).toContain('az 5.3. pontban a fotók magyar megnevezést kaptak');
    expect(t).not.toContain('a 7. pontban a fotók magyar megnevezést kaptak');
    expect(alpont(container, '5.3.')).toContain('felvételi és lerakodási fotókat');
    expect(fejezet(container, 'pont-7')).not.toMatch(/felvételi és lerakodási/);
  });

  it('a GPS-napló csak „ha rendelkezésre áll” — élő helymegosztás a weben nincs (fix2-review)', () => {
    const { container } = render(<AszfPage />);
    const ot = fejezet(container, 'pont-5');
    const het = fejezet(container, 'pont-7');
    expect(het).not.toMatch(/GPS-log/);
    let talalat = 0;
    for (const szoveg of [ot, het]) {
      for (const m of szoveg.matchAll(/GPS-napló/g)) {
        talalat += 1;
        expect(szoveg.slice(m.index!, m.index! + 40)).toContain('ha rendelkezésre áll');
      }
    }
    expect(talalat).toBeGreaterThan(0);
    expect(normal(container.textContent)).toContain('az 5.2. és a 7. pontban a GPS-napló csak akkor bizonyíték, ha rendelkezésre áll');
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
    // A képlet minden összetevője (services/trustScore.js) — a „Verified EU
    // Carrier” 20 pontja is (fix1-review).
    expect(hat).toContain('„ellenőrzött szállító” jelzőből');
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

  it('a fuvarfeladás piszkozata és a szállítói szűrők is a táblázatban vannak (fix2-review)', () => {
    // A kulcsneveket a kódból vesszük — egy átnevezés itt is pirosat ad.
    const { container } = render(<AdatkezelesPage />);
    const tabla = normal(container.querySelector('.jogi-tablazat')!.textContent);
    expect(tabla).toContain(`${UJ_FUVAR_PISZKOZAT_ELOTAG}:<azonosító>`);
    expect(tabla).toContain('a címzett neve, telefonszáma és e-mail-címe');
    expect(tabla).toContain('legfeljebb 7 napig');
    const fuvarlista = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'sofor', 'fuvarok', 'page.tsx'), 'utf8');
    const szurok = fuvarlista.match(/SZUROK_KULCS = '([a-z_]+)'/)![1];
    expect(tabla).toContain(szurok);
  });
});
