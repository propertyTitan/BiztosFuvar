// Globális Next.js layout – magyar nyelv, GoFuvar branding.
// A fejléc (SiteHeader) egy client komponens, ami role-érzékenyen rajzolja
// ki a menüt (feladó / sofőr / admin / nem bejelentkezett).
import './globals.css';
import type { Metadata } from 'next';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import AiChatWidget from '@/components/AiChatWidget';
import { ToastProvider } from '@/components/ToastProvider';
import KycModalProvider from '@/components/KycModalProvider';
import CoverageModal from '@/components/CoverageModal';
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
          <CoverageModal />
          <SiteHeader />
          <main className="site-main">{children}</main>
          <SiteFooter />
          <AiChatWidget />
        </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
