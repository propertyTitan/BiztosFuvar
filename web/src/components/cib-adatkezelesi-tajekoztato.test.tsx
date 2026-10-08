import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdatkezelesPage from '../../app/adatkezeles/page';
import { CIB_ADATKEZELESI_LINK } from '@/lib/cibFeliratok';

// A CIB írásos válasza (2026-10-01): az adattovábbítási hozzájárulás a
// kártyás fizetéshez kötelező, és a fizetési kártya nyilatkozata az
// „Adatkezelési tájékoztató" CIB-szakaszára hivatkozik. Ez az őr a
// MEGJELENÍTETT tájékoztatót nézi: a szakasz létezik, a link célja egyezik a
// szakasz azonosítójával, és a bank által kért tartalom benne van — a jogi
// szöveg egy átfogalmazása vagy a horgony átnevezése így nem csúszhat el
// némán (a nyilatkozat linkje egy nem létező helyre mutatna).

const normal = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();

function cibSzakasz(): string {
  const { container } = render(<AdatkezelesPage />);
  const cim = container.querySelector('#cib-kartyas-fizetes');
  expect(cim, 'a tájékoztatóban nincs id="cib-kartyas-fizetes" szakasz').not.toBeNull();
  // A szakasz a címtől a következő <h2>-ig tart.
  const reszek: string[] = [normal(cim?.textContent)];
  let el = cim?.nextElementSibling || null;
  while (el && el.tagName !== 'H2') {
    reszek.push(normal(el.textContent));
    el = el.nextElementSibling;
  }
  return reszek.join(' ');
}

describe('Adatkezelési tájékoztató — a bankkártyás fizetés (CIB) szakasza', () => {
  it('a nyilatkozat linkje a szakasz azonosítójára mutat', () => {
    const [ut, horgony] = CIB_ADATKEZELESI_LINK.href.split('#');
    expect(ut).toBe('/adatkezeles');
    expect(horgony).toBe('cib-kartyas-fizetes');
    const { container } = render(<AdatkezelesPage />);
    expect(container.querySelector(`#${horgony}`)?.tagName).toBe('H2');
  });

  it('a szakasz címe és a bank által kért tartalom', () => {
    const szoveg = cibSzakasz();
    expect(szoveg).toContain('Bankkártyás fizetés (CIB Bank Zrt.)');
    for (const mondat of [
      'Adatkezelő: Tiszta Hód Kft. (6800 Hódmezővásárhely, Szántó Kovács János utca 144.; telefon: +36 20 397 9223; fax: nincs; e-mail: info@gofuvar.hu). Adatvédelmi tisztviselő: nincs kijelölve.',
      'A kapcsolatfelvételi díj bankkártyás fizetését a CIB Bank Zrt. (1024 Budapest, Petrezselyem u. 2–8.) bonyolítja. A kártyaadatokat (kártyaszám, lejárati dátum, ellenőrző kód) Ön közvetlenül a CIB Bank fizetőoldalán adja meg; ezeket a GoFuvar nem látja és nem tárolja. A kártyaadatok kezelésére a CIB Bank Zrt. saját adatkezelési tájékoztatója vonatkozik.',
      'A CIB Bank részére továbbított adatok: a tranzakció azonosítója, a fizetendő összeg és pénznem, valamint egy álnevesített vásárló-azonosító, amelyből az Ön személye nem állapítható meg. A nevét, számlázási címét, e-mail-címét és telefonszámát nem továbbítjuk a banknak.',
      'Az adatkezelés célja a kapcsolatfelvételi díj bankkártyás megfizetése. Jogalapja a szolgáltatási szerződés teljesítése (GDPR 6. cikk (1) bekezdés b) pont), valamint a fizetéskor adott, a CIB Bank által előírt hozzájárulása (GDPR 6. cikk (1) bekezdés a) pont). Hozzájárulását bármikor visszavonhatja; ez nem érinti a visszavonás előtti adatkezelés jogszerűségét. A bankkártyás fizetés a nyilatkozat elfogadásával indítható.',
      'A fizetés eredményéről a banktól kapott adatokat (tranzakció-azonosító, eredménykód és annak szöveges leírása, összeg, engedélyszám) a díjbizonylattal együtt a számviteli előírások szerint 8 évig őrizzük. A bankkal váltott titkosított technikai üzenetek naplóját 13 hónapig őrizzük, a banki reklamációk kivizsgálásához.',
      'Jogairól és a jogorvoslati lehetőségekről (NAIH) a jelen tájékoztató vonatkozó pontjai rendelkeznek.',
    ]) {
      expect(szoveg, `hiányzó mondat: ${mondat.slice(0, 60)}…`).toContain(mondat);
    }
  });

  it('a CIB címe az adatfeldolgozók listájában is a helyes (1024 Budapest, Petrezselyem u. 2–8.), a régi cím sehol', () => {
    render(<AdatkezelesPage />);
    const teljes = normal(document.body.textContent);
    expect(teljes).toContain('CIB Bank Zrt. (1024 Budapest, Petrezselyem u. 2–8.)');
    expect(teljes).not.toContain('1027 Budapest');
  });

  it('a hatályosság dátuma 2026. október 8. (UX-kör A4: a Trust Score-szöveg a kódhoz igazítva)', () => {
    render(<AdatkezelesPage />);
    expect(normal(screen.getByText(/Hatályos:/).closest('p')?.textContent)).toBe('Hatályos: 2026. október 8-tól');
  });

  // 2026-10-01 (a PR-4 1. javítóköre): a 4/A. szakasz hozzájárulásra épít —
  // a 3. „jogalap" szakasz eddig a hozzájárulást nem sorolta (jogi
  // koherencia); a NAIH-ra utaló mondat a jogok szakaszára linkel; a
  // horgonyra ugráskor a sticky fejléc nem takarja el a címet.
  it('a 3. „jogalap" szakasz a hozzájárulást is sorolja, a 4/A. pontra utalva', () => {
    const { container } = render(<AdatkezelesPage />);
    const cim = [...container.querySelectorAll('h2')].find((h) => /3\. Az adatkezelés jogalapja/.test(h.textContent || ''));
    expect(cim, 'nincs 3. jogalap-szakasz').toBeTruthy();
    const reszek: string[] = [];
    let el = cim?.nextElementSibling || null;
    while (el && el.tagName !== 'H2') {
      reszek.push(normal(el.textContent));
      el = el.nextElementSibling;
    }
    const szoveg = reszek.join(' ');
    expect(szoveg).toMatch(/Hozzájárulás/);
    expect(szoveg).toContain('GDPR 6. cikk (1) a)');
    expect(szoveg).toMatch(/4\/A\. pont/);
  });

  it('a 4/A. szakasz NAIH-mondata a jogok szakaszára linkel, és az a horgony létezik', () => {
    const { container } = render(<AdatkezelesPage />);
    const cim = container.querySelector('#cib-kartyas-fizetes');
    const lista = cim?.nextElementSibling;
    const utolso = lista?.querySelector('li:last-child');
    expect(normal(utolso?.textContent)).toBe('Jogairól és a jogorvoslati lehetőségekről (NAIH) a jelen tájékoztató vonatkozó pontjai rendelkeznek.');
    const link = utolso?.querySelector('a');
    expect(link, 'a NAIH-mondatban nincs link a jogok szakaszára').toBeTruthy();
    const horgony = (link?.getAttribute('href') || '').replace(/^#/, '');
    expect(horgony).toBeTruthy();
    const jogok = container.querySelector(`#${horgony}`);
    expect(jogok?.tagName).toBe('H2');
    expect(normal(jogok?.textContent)).toMatch(/Az Érintettek Jogai/);
  });

  it('a CIB-szakasz címe a sticky fejléc alá nem bukik (scroll-margin)', () => {
    const { container } = render(<AdatkezelesPage />);
    const cim = container.querySelector('#cib-kartyas-fizetes') as HTMLElement | null;
    expect(cim?.style.scrollMarginTop).toBe('80px');
  });

  it('szövegszabály: a tájékoztató nem ígér „biztonságos fizetést"', () => {
    render(<AdatkezelesPage />);
    expect(document.body.textContent || '').not.toMatch(/biztonságos\s+fizetés/i);
  });
});
