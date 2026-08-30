'use client';

// Aktuális bejelentkezett user kezelése – localStorage-ból olvassa.
// Nincs külön context, nincs külön provider, egy hook, ami a kliensen
// bármikor visszaadja az aktuális role-t. A login/logout hívásokkor
// a komponens re-render-el (custom event a storage update-re).
import { useEffect, useState } from 'react';
import { refreshSocketAuth } from './socket';

export type Role = 'shipper' | 'carrier' | 'admin';

export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  full_name?: string;
  account_type?: 'individual' | 'company';
  /**
   * Profilkép. A fejléc ebből rajzolja a kis kört; ha nincs, monogram jön.
   *
   * ⚠️ 2026-08-15 (tesztelői észrevétel): eddig NEM volt itt, ezért a fejléc
   * SOHA nem mutatott avatart — a tesztelő hiába cserélt képet a profilon, a
   * jobb felső sarok nem változott, és ki-/bejelentkezés sem segített (a
   * bejelentkezési válasz sem hozta). A `frissitCurrentUser` gondoskodik
   * arról, hogy kép-csere után AZONNAL frissüljön, újratöltés nélkül.
   */
  avatar_url?: string | null;
};

const EVENT = 'gofuvar:auth';

export function setCurrentUser(user: CurrentUser, token: string) {
  window.localStorage.setItem('gofuvar_user', JSON.stringify(user));
  window.localStorage.setItem('gofuvar_token', token);
  // GF-016/017 (2026-08-30): ha a socket a belépés ELŐTT nyílt (token
  // nélkül), újra kell kötni, hogy a handshake-be bekerüljön a friss token —
  // különben a chat + értesítések élő frissítése a teljes újratöltésig halott.
  refreshSocketAuth();
  window.dispatchEvent(new Event(EVENT));
}

/**
 * A tárolt user RÉSZLEGES frissítése (pl. profilkép-csere után), a token
 * érintetlenül hagyásával. Ugyanazt az eseményt küldi, mint a be-/kijelentkezés,
 * így minden `useCurrentUser()` hook azonnal újrarendel — nem kell újratölteni.
 */
export function frissitCurrentUser(patch: Partial<CurrentUser>) {
  const jelenlegi = readUser();
  if (!jelenlegi) return;
  window.localStorage.setItem('gofuvar_user', JSON.stringify({ ...jelenlegi, ...patch }));
  window.dispatchEvent(new Event(EVENT));
}

export function clearCurrentUser() {
  window.localStorage.removeItem('gofuvar_user');
  window.localStorage.removeItem('gofuvar_token');
  // GF-006 (Manus, 2026-08-30): a régi, GLOBÁLIS mód-kulcs kijelentkezéskor
  // bent maradt, és a KÖVETKEZŐ (másik!) fiók örökölte — egy feladó szállítói
  // fejlécet kapott. A mód azóta felhasználóhoz kötött (lásd lent), a globális
  // kulcsot itt csak takarítjuk, hogy régi böngészőkben se szivárogjon át.
  window.localStorage.removeItem('gofuvar_mode');
  window.dispatchEvent(new Event(EVENT));
}

// ── Feladó/Szállító mód — FELHASZNÁLÓHOZ kötve (GF-006, 2026-08-30) ──────
//
// A mód (melyik nézetet látja: feladó vagy szállító) korábban egyetlen
// globális 'gofuvar_mode' kulcsban élt: kijelentkezés után a következő fiók
// ÖRÖKÖLTE az előző módját. Mostantól a kulcs a user id-jával képződik —
// másik fiókhoz át nem szivárog, ugyanaz a fiók viszont visszakapja a saját
// beállítását. Minden olvasó/író EZEKEN a helpereken megy (HomeHub,
// SiteHeader, not-found) — közvetlen localStorage-hozzáférés a módhoz TILOS.

export type AppMode = 'shipper' | 'driver';

function modeKey(userId: string) {
  return `gofuvar_mode:${userId}`;
}

/** A BEJELENTKEZETT user tárolt módja; nincs user vagy nincs mentés → null. */
export function readStoredMode(): AppMode | null {
  const u = readUser();
  if (!u) return null;
  const v = window.localStorage.getItem(modeKey(u.id));
  return v === 'shipper' || v === 'driver' ? v : null;
}

/** Mód mentése a bejelentkezett userhez + a fejléc mód-chipjének értesítése. */
export function writeStoredMode(mode: AppMode) {
  const u = readUser();
  if (!u) return;
  window.localStorage.setItem(modeKey(u.id), mode);
  window.dispatchEvent(new Event('gofuvar:mode-change'));
}

function readUser(): CurrentUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem('gofuvar_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

/**
 * Reaktív hook: az aktuális bejelentkezett user.
 * Null, ha nincs belépve. A komponens automatikusan frissül, ha máshol
 * login/logout történik (pl. másik tabon, vagy ugyanazon az oldalon).
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);

  useEffect(() => {
    setUser(readUser());
    const onChange = () => setUser(readUser());
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  return user;
}

/**
 * A login utáni alapértelmezett kezdőoldal — mindenki a hub-ra érkezik,
 * és onnan választ menüpontot.
 */
export function homeForRole(_role: Role): string {
  return '/';
}
