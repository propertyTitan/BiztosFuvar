// A feladói fuvar-részletoldal címe (UX-kör A25, 2026-10-08): eddig minden
// fuvaroldal a „Feladói felület" címet viselte. A robots: noindex a
// /dashboard layouttól öröklődik.
// ⚠️ A fuvarra szabott cím („Kanapé szállítása … – Ajánlatokat vár") az oldal
// betöltött adatából jönne — azt az oldal kliens-kódja állíthatja be.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Fuvar részletei',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
