// Globális Next.js layout – magyar nyelv, GoFuvar branding.
// PWA-ként telepíthető — manifest.webmanifest + apple-touch-icon meta-k
// gondoskodnak róla, hogy a user a kezdőképernyőjére telepíthesse a
// böngészőjéből, így „app-érzettel" használhatja a natív app megjelenéséig.
import './globals.css';
import type { Metadata, Viewport } from 'next';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import AiChatWidget from '@/components/AiChatWidget';
import EmailVerifyBanner from '@/components/EmailVerifyBanner';
import CookieConsentBanner from '@/components/CookieConsentBanner';
import InstallPromptBanner from '@/components/InstallPromptBanner';
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
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'GoFuvar',
  },
  icons: {
    icon: [
      { url: '/logo-icon.svg?v=3', type: 'image/svg+xml' },
    ],
    apple: [
      { url: '/logo-icon.svg?v=3', type: 'image/svg+xml' },
    ],
  },
};

export const viewport: Viewport = {
  // theme-color = a böngésző / iOS status-bar színe ha standalone módban indítják
  themeColor: '#1e40af',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* iOS Safari PWA-támogatás (a Next.js metadata API nem mindig
            generálja ezeket konzisztensen, ezért explicit kihúzzuk) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="GoFuvar" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="GoFuvar" />
      </head>
      <body>
        <I18nProvider>
        <ToastProvider>
          <KycModalProvider />
          <CoverageModal />
          <SiteHeader />
          <EmailVerifyBanner />
          <InstallPromptBanner />
          <main className="site-main">{children}</main>
          <SiteFooter />
          <AiChatWidget />
          <CookieConsentBanner />
        </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
