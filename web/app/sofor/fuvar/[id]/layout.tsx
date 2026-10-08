// A szállítói fuvar-részletoldal címe (UX-kör A25, 2026-10-08): eddig minden
// fuvaroldal a „Szállítói felület" címet viselte. A robots: noindex és a
// szállítói nyilatkozat-kapu a /sofor layouttól öröklődik.
// ⚠️ A fuvarra szabott cím az oldal betöltött adatából jönne — azt az oldal
// kliens-kódja állíthatja be.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Fuvar részletei — szállító',
};

export default function SegmentLayout({ children }: { children: ReactNode }) {
  return children;
}
