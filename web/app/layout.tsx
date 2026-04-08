// Globális Next.js layout – magyar nyelv, BiztosFuvar branding.
// A fejléc (SiteHeader) egy client komponens, ami role-érzékenyen rajzolja
// ki a menüt (feladó / sofőr / admin / nem bejelentkezett).
import './globals.css';
import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'BiztosFuvar',
  description: 'Magyarországi közösségi fuvartőzsde – feladóknak és sofőröknek.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>
        <SiteHeader />
        <main className="site-main">{children}</main>
        <footer className="site-footer">© BiztosFuvar – Bizalom. Fotó. GPS. Letét.</footer>
      </body>
    </html>
  );
}
