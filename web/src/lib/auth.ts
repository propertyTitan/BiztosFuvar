'use client';

// Aktuális bejelentkezett user kezelése – localStorage-ból olvassa.
// Nincs külön context, nincs külön provider, egy hook, ami a kliensen
// bármikor visszaadja az aktuális role-t. A login/logout hívásokkor
// a komponens re-render-el (custom event a storage update-re).
import { useEffect, useState } from 'react';

export type Role = 'shipper' | 'carrier' | 'admin';

export type CurrentUser = {
  id: string;
  email: string;
  role: Role;
  full_name?: string;
  account_type?: 'individual' | 'company';
};

const EVENT = 'gofuvar:auth';

export function setCurrentUser(user: CurrentUser, token: string) {
  window.localStorage.setItem('gofuvar_user', JSON.stringify(user));
  window.localStorage.setItem('gofuvar_token', token);
  window.dispatchEvent(new Event(EVENT));
}

export function clearCurrentUser() {
  window.localStorage.removeItem('gofuvar_user');
  window.localStorage.removeItem('gofuvar_token');
  window.dispatchEvent(new Event(EVENT));
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
