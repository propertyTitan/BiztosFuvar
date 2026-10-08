// =====================================================================
//  PWA-TELEPÍTŐ SÁV — UX-kör A24 (2026-10-08)
//
//  A régi sáv iOS-en 3 másodperccel a betöltés után, MÁR AZ ELSŐ
//  LÁTOGATÁSKOR beugrott a fejléc alá a dokumentumfolyamba: a hero olvasás
//  közben lejjebb csúszott, és a landingen, a regisztráción és a
//  fuvarfeladáson is megjelent. Ez az őr a javított szabályokat méri.
// =====================================================================
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import InstallPromptBanner, {
  DISMISS_DURATION_DAYS, jelolElsoSiker, telepitoSavIdozitesOk, telepitoSavOldalonEngedett,
} from './InstallPromptBanner';

const m = vi.hoisted(() => ({ ut: '/fuvarjaim' }));
vi.mock('next/navigation', () => ({ usePathname: () => m.ut }));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const eredetiUa = navigator.userAgent;

function ua(ertek: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ertek, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('gofuvar_cookie_consent', 'accepted');
  ua(IPHONE);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as any;
  m.ut = '/fuvarjaim';
});
afterEach(() => ua(eredetiUa));

async function rendereles() {
  render(<InstallPromptBanner />);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const sav = () => screen.queryByRole('region', { name: 'Telepítés a kezdőképernyőre' });

describe('hol jelenhet meg', () => {
  it('a fókuszt igénylő oldalakon soha', () => {
    for (const ut of ['/', '/bejelentkezes', '/dashboard/uj-fuvar', '/fizetes/eredmeny',
      '/hozasd-el', '/hozasd-el/butor', '/aszf', '/adatkezeles', '/soforoknek', '/fuvar/budapest-szeged',
      '/butorszallitas']) {
      expect(telepitoSavOldalonEngedett(ut), ut).toBe(false);
    }
    for (const ut of ['/fuvarjaim', '/ertesitesek', '/sofor/fuvarok', '/profil']) {
      expect(telepitoSavOldalonEngedett(ut), ut).toBe(true);
    }
  });

  it('időzítés: az első érdemi siker után, vagy a második munkamenettől', () => {
    expect(telepitoSavIdozitesOk(1, false)).toBe(false);
    expect(telepitoSavIdozitesOk(2, false)).toBe(true);
    expect(telepitoSavIdozitesOk(1, true)).toBe(true);
  });

  it('„Most ne" után 30 napig nem', () => {
    expect(DISMISS_DURATION_DAYS).toBe(30);
  });
});

describe('a sáv a valódi komponensben', () => {
  it('az ELSŐ látogatáskor nem jelenik meg (iPhone, listaoldal)', async () => {
    await rendereles();
    expect(sav()).toBeNull();
  });

  it('a második munkamenettől megjelenik — fix alsó panelként, lucide ikonnal', async () => {
    localStorage.setItem('gofuvar_install_visits', '1');
    await rendereles();
    const panel = sav();
    expect(panel).not.toBeNull();
    expect(panel).toHaveClass('telepito-panel');
    expect(panel!.textContent, 'emoji helyett lucide ikon').not.toMatch(/📱|⬆/);
    expect(panel!.querySelector('svg')).not.toBeNull();
  });

  it('a második munkamenetben sem a főoldalon', async () => {
    localStorage.setItem('gofuvar_install_visits', '1');
    m.ut = '/';
    await rendereles();
    expect(sav()).toBeNull();
  });

  it('a süti-döntés előtt nem (a két alsó sáv nem rakódhat egymásra)', async () => {
    localStorage.removeItem('gofuvar_cookie_consent');
    localStorage.setItem('gofuvar_install_visits', '1');
    await rendereles();
    expect(sav()).toBeNull();
  });

  it('az első érdemi siker után ugyanabban a munkamenetben is megjelenhet', async () => {
    await rendereles();
    expect(sav()).toBeNull();
    act(() => jelolElsoSiker());
    expect(sav()).not.toBeNull();
  });

  it('asztali böngészőben soha', async () => {
    ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15');
    localStorage.setItem('gofuvar_install_visits', '5');
    await rendereles();
    expect(sav()).toBeNull();
  });
});

describe('az „első érdemi siker” jelzése be van kötve (A23)', () => {
  // Enélkül a sáv csak a második munkamenettől jönne: a jelolElsoSiker()
  // egyetlen hívó nélkül halott kód lenne.
  it.each([
    ['a sikeres fuvarfeladás után', 'app/dashboard/uj-fuvar/page.tsx'],
    ['az elküldött ajánlat után', 'app/sofor/fuvar/[id]/page.tsx'],
  ])('%s hívódik', (_mikor, fajl) => {
    const forras = fs.readFileSync(path.join(process.cwd(), fajl), 'utf8');
    expect(forras).toMatch(/import \{ jelolElsoSiker \} from '@\/components\/InstallPromptBanner'/);
    expect(forras).toMatch(/\n\s+jelolElsoSiker\(\);/);
  });
});
