'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { watchSessionChanges } from '@/lib/auth';

/** Fiókcserekor az összes korábbi felületi állapotot együtt dobjuk el. */
export default function AuthSessionBoundary({ children }: { children: ReactNode }) {
  const [resetting, setResetting] = useState(false);
  useEffect(() => watchSessionChanges(destination => {
    // Már a navigáció előtt tűnjön el a korábbi PIN/chat/toast. A teljes
    // betöltés a modul-cache-eket és a függő kéréseket is eldobja.
    flushSync(() => setResetting(true));
    window.location.replace(destination);
  }), []);
  return resetting ? <p role="status">Munkamenet frissítése…</p> : children;
}
