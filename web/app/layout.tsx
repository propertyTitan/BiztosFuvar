// Globális Next.js layout – magyar nyelv, GoFuvar branding.
// A fejléc (SiteHeader) egy client komponens, ami role-érzékenyen rajzolja
// ki a menüt (feladó / sofőr / admin / nem bejelentkezett).
import './globals.css';
import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import AiChatWidget from '@/components/AiChatWidget';
import { ToastProvider } from '@/components/ToastProvider';
import KycModalProvider from '@/components/KycModalProvider';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'GoFuvar – Magyarország közösségi fuvartőzsdéje',
  description:
    'Hirdess meg egy fuvart és a sofőrök licitálnak rá, vagy foglalj helyet egy útba eső sofőr fix áras útvonalán. Biztonságos Barion letét, élő GPS követés, fotó bizonyíték, 6 jegyű átvételi kód. Ingyenes regisztráció.',
  keywords: [
    'fuvar', 'szállítás', 'csomag', 'költöztetés', 'sofőr', 'fuvartőzsde',
    'GoFuvar', 'közösségi szállítás', 'licit', 'fix áras fuvar',
    'Barion', 'escrow', 'Magyarország',
  ],
  openGraph: {
    title: 'GoFuvar – Közösségi fuvartőzsde',
    description: 'Csomagod van? Sofőröd is lesz. Biztonságos fizetés, élő követés, fotó bizonyíték.',
    type: 'website',
    locale: 'hu_HU',
  },
  icons: {
    icon: '/logo-icon.svg?v=2',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>
        <I18nProvider>
        <ToastProvider>
          <KycModalProvider />
          <SiteHeader />
          <main className="site-main">{children}</main>
          <footer className="site-footer">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>🚛 GoFuvar</div>
            <div>Bizalom. Fotó. Kód. Letét.</div>
            <div style={{ marginTop: 10, fontSize: 13, display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href="/aszf" style={{ color: 'inherit', textDecoration: 'underline' }}>ÁSZF</a>
              <a href="/adatkezeles" style={{ color: 'inherit', textDecoration: 'underline' }}>Adatkezelési tájékoztató</a>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>© {new Date().getFullYear()} GoFuvar Kft. · Minden jog fenntartva.</div>
          </footer>
          <AiChatWidget />
        </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
