// Téma-kapcsoló (2026-08-04, tesztelői kérés) — a döntési logika tesztjei.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  THEME_BOOT_SCRIPT, THEME_CYCLE, THEME_STORAGE_KEY,
  nextThemeChoice, normalizeChoice, readThemeChoice, resolveTheme, setThemeChoice,
} from './theme';

/** matchMedia mock: az OS sötét/világos preferenciájának állítása. */
function mockSystemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  mockSystemDark(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeChoice', () => {
  it('a három érvényes értéket átengedi', () => {
    expect(normalizeChoice('light')).toBe('light');
    expect(normalizeChoice('dark')).toBe('dark');
    expect(normalizeChoice('system')).toBe('system');
  });

  it('bármi másra „system" (sérült/idegen localStorage-érték)', () => {
    expect(normalizeChoice(null)).toBe('system');
    expect(normalizeChoice('DARK')).toBe('system');
    expect(normalizeChoice('{}')).toBe('system');
    expect(normalizeChoice(42)).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('a kényszerített választás felülírja az OS-t', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('„system" az OS-t követi', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});

describe('körkörös léptetés', () => {
  it('világos → sötét → rendszer → világos', () => {
    expect(nextThemeChoice('light')).toBe('dark');
    expect(nextThemeChoice('dark')).toBe('system');
    expect(nextThemeChoice('system')).toBe('light');
  });

  it('a ciklus mindhárom állapotot érinti, ismétlés nélkül', () => {
    expect(new Set(THEME_CYCLE).size).toBe(3);
  });
});

describe('setThemeChoice / readThemeChoice', () => {
  it('kényszerített témát eltárol és ráírja a <html>-re', () => {
    setThemeChoice('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(readThemeChoice()).toBe('dark');
  });

  it('„system" TÖRLI a bejegyzést, és az OS szerint old fel', () => {
    setThemeChoice('dark');
    mockSystemDark(true);
    setThemeChoice('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(readThemeChoice()).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('értesíti a többi komponenst (esemény)', () => {
    const spy = vi.fn();
    window.addEventListener('gofuvar:theme', spy);
    setThemeChoice('light');
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('gofuvar:theme', spy);
  });
});

// A <head>-be tett boot-szkript szándékosan DUPLIKÁLJA a logikát (a bundle-ból
// importálva már késő lenne — villanna a rossz téma). Ez a teszt őrzi, hogy a
// két példány ne csússzon szét: a szkriptet ténylegesen lefuttatjuk.
describe('THEME_BOOT_SCRIPT — a festés előtti szkript', () => {
  function runBootScript() {
    document.documentElement.removeAttribute('data-theme');
    // eslint-disable-next-line no-new-func
    new Function(THEME_BOOT_SCRIPT)();
    return document.documentElement.getAttribute('data-theme');
  }

  it('ugyanazt a kulcsot olvassa, mint a modul', () => {
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY);
  });

  it('mentett választás nélkül az OS-t követi', () => {
    mockSystemDark(true);
    expect(runBootScript()).toBe('dark');
    mockSystemDark(false);
    expect(runBootScript()).toBe('light');
  });

  it('a mentett választás felülírja az OS-t — ugyanúgy, mint a resolveTheme', () => {
    mockSystemDark(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(runBootScript()).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');

    mockSystemDark(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(runBootScript()).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('sérült tárolt értékre az OS-re esik vissza (nem írja be nyersen)', () => {
    mockSystemDark(true);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'kekeskék');
    expect(runBootScript()).toBe('dark');
  });

  it('sosem írja be a „system"-et attribútumként', () => {
    mockSystemDark(false);
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
    expect(runBootScript()).toBe('light');
  });
});
