// Globális Next.js layout – magyar nyelv, BiztosFuvar branding.
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BiztosFuvar – Feladói felület',
  description: 'Magyarországi közösségi fuvartőzsde – feladók és admin felülete.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>
        <header className="site-header">
          <a href="/" className="brand">BiztosFuvar</a>
          <nav>
            <a href="/dashboard">Irányítópult</a>
            <a href="/dashboard/uj-fuvar">Új fuvar</a>
            <a href="/bejelentkezes">Belépés</a>
          </nav>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">© BiztosFuvar – Bizalom. Fotó. GPS. Letét.</footer>
      </body>
    </html>
  );
}
