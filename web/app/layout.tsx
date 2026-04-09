// Globális Next.js layout – magyar nyelv, GoFuvar branding.
// A fejléc (SiteHeader) egy client komponens, ami role-érzékenyen rajzolja
// ki a menüt (feladó / sofőr / admin / nem bejelentkezett).
import './globals.css';
import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import AiChatWidget from '@/components/AiChatWidget';

export const metadata: Metadata = {
  title: 'GoFuvar',
  description: 'Magyarországi közösségi fuvartőzsde – feladóknak és sofőröknek.',
  icons: {
    icon: '/logo-icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>
        <SiteHeader />
        <main className="site-main">{children}</main>
        <footer className="site-footer">© GoFuvar – Bizalom. Fotó. Kód. Letét.</footer>
        <AiChatWidget />
      </body>
    </html>
  );
}
