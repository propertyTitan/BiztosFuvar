// =====================================================================
//  Téma (világos / sötét) — a döntési logika EGYETLEN helye
//
//  Három állapot:
//    'system' — az operációs rendszer beállítását követi (élőben is, ha a
//               user az OS-ben átvált) — KIFEJEZETT választással érhető el
//    'light'  — kényszerített világos
//    'dark'   — kényszerített sötét (ALAPÉRTELMEZÉS, 2026-08-22, user-döntés:
//               „sokkal jobban néz ki az oldal" — tárolt választás nélkül
//               mindenki ezt kapja; a kapcsoló marad, bárki átválthat)
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

/** Érvényes-e a tárolt érték? (Bármi más → 'dark' — ez az alapértelmezés.) */
export function normalizeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'dark';
}

/** A mentett választás. SSR-en és hibánál 'dark' (az alapértelmezés). */
export function readThemeChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'dark';
  try {
    return normalizeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // privát mód / letiltott storage — ne dőljön el az oldal miatta
    return 'dark';
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
    // ⚠️ A 'system' is ELTÁROLÓDIK (2026-08-22). Korábban a 'system' törölte
    // a bejegyzést („nincs kulcs = rendszer-mód") — de az alapértelmezés
    // mostantól a SÖTÉT, tehát a hiányzó kulcs dark-ot jelent: ha a 'system'
    // választás nem íródna ki, a következő betöltésre elveszne.
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
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
// ⚠️ 2026-08-22 (user-döntés): tárolt választás nélkül az alap a SÖTÉT téma.
// A 'system' csak KIFEJEZETT (eltárolt) választásként követi az OS-t.
export const THEME_BOOT_SCRIPT = `(function(){try{
var c=localStorage.getItem('${THEME_STORAGE_KEY}');
if(c==='system'){c=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
else if(c!=='light'&&c!=='dark'){c='dark';}
document.documentElement.setAttribute('data-theme',c);
}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
