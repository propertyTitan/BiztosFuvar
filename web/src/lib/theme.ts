// =====================================================================
//  Téma (világos / sötét) — a döntési logika EGYETLEN helye
//
//  Három állapot:
//    'system' — az operációs rendszer beállítását követi (ALAPÉRTELMEZÉS,
//               és élőben követi is, ha a user az OS-ben átvált)
//    'light'  — kényszerített világos
//    'dark'   — kényszerített sötét
//
//  A tényleges témát a <html data-theme="light|dark"> attribútum hordozza,
//  amire a globals.css épül. A `system` SOSEM kerül az attribútumba —
//  ott mindig a feloldott (light/dark) érték áll.
//
//  A választás localStorage-ban él (`gofuvar_theme`); a
//  `layout.tsx`-be tett, festés előtt futó szkript ugyanezt olvassa, hogy
//  betöltéskor ne villanjon fel a rossz téma.
// =====================================================================

export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'gofuvar_theme';
/** A komponensek erre az eseményre frissítik magukat (más tab / másik gomb). */
export const THEME_EVENT = 'gofuvar:theme';

/** Érvényes-e a tárolt érték? (Bármi más → 'system'.) */
export function normalizeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** A mentett választás. SSR-en 'system' (nincs localStorage). */
export function readThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    return normalizeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // privát mód / letiltott storage — ne dőljön el az oldal miatta
    return 'system';
  }
}

/** Sötétet kér-e az operációs rendszer? */
export function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** A választásból a ténylegesen megjelenítendő téma. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  if (choice === 'light' || choice === 'dark') return choice;
  return systemDark ? 'dark' : 'light';
}

/** A feloldott témát ráírja a <html>-re. */
export function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolved);
}

/**
 * Téma beállítása: eltárol + azonnal alkalmaz + szól a többi komponensnek.
 * 'system' esetén a választást töröljük a tárolóból (az alapértelmezés
 * "nincs bejegyzés" — így egy későbbi default-váltás is működne).
 */
export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch { /* storage letiltva — a téma a munkamenetre akkor is átáll */ }
  applyResolvedTheme(resolveTheme(choice, prefersDark()));
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** A körkörös léptetés sorrendje a fejléc-gombhoz. */
export const THEME_CYCLE: ThemeChoice[] = ['light', 'dark', 'system'];

export function nextThemeChoice(current: ThemeChoice): ThemeChoice {
  const i = THEME_CYCLE.indexOf(current);
  return THEME_CYCLE[(i + 1) % THEME_CYCLE.length];
}

export const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Világos',
  dark: 'Sötét',
  system: 'Rendszer',
};

/**
 * A <head>-be, festés ELŐTT befuttatandó szkript forrása.
 *
 * Ez a fájl többi részének kicsinyített mása — szándékosan duplikált,
 * mert a bundle-ból importálni már késő lenne (a React-hidratálás után
 * futna, addigra a rossz témával kifestett oldal látszana).
 * Ha a kulcs vagy az attribútum neve változik, ITT IS át kell írni —
 * a `theme.test.ts` erre külön figyel.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{
var c=localStorage.getItem('${THEME_STORAGE_KEY}');
if(c!=='light'&&c!=='dark'){c=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
document.documentElement.setAttribute('data-theme',c);
}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
