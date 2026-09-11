import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Feladói felület (2026-09-11, C2): privát/hitelesített — ne indexelődjön,
// akkor sem, ha a robots.txt a launchkor Allow-ra vált.
export const metadata: Metadata = {
  title: 'Feladói felület',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
