// Globális Next.js layout – magyar nyelv, GoFuvar branding.
// PWA-ként telepíthető — manifest.webmanifest + apple-touch-icon meta-k
// gondoskodnak róla, hogy a user a kezdőképernyőjére telepíthesse a
// böngészőjéből, így „app-érzettel" használhatja a natív app megjelenéséig.
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import AiChatWidget from '@/components/AiChatWidget';
import EmailVerifyBanner from '@/components/EmailVerifyBanner';
import CookieConsentBanner from '@/components/CookieConsentBanner';
import InstallPromptBanner from '@/components/InstallPromptBanner';
import { ToastProvider } from '@/components/ToastProvider';
import KycModalProvider from '@/components/KycModalProvider';
import CoverageModal from '@/components/CoverageModal';
import TestModeBanner from '@/components/TestModeBanner';
import { I18nProvider } from '@/lib/i18n';

// Inter önállóan, layout-shift nélkül (a globals.css @import helyett).
const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  // template: az al-oldalak layout.tsx-ei csak a saját címüket adják meg,
  // a "| GoFuvar" utótag innen jön
  title: {
    default: 'GoFuvar – Magyarország közösségi fuvartőzsdéje',
    template: '%s | GoFuvar',
  },
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
  // Az icons mező elhagyva: a Next.js az app/favicon.ico, app/icon.png és
  // app/apple-icon.png fájlokból automatikusan generálja a linkeket
  // (ICO fallback régi böngészőknek + PNG apple-touch-icon — az SVG-t
  // az iOS főképernyő nem tudta megjeleníteni).
};

export const viewport: Viewport = {
  // theme-color = a böngésző / iOS status-bar színe ha standalone módban indítják
  themeColor: 'var(--primary)',
  width: 'device-width',
  initialScale: 1,
  // A pinch-zoom engedélyezve marad (akadálymentesség, WCAG 1.4.4) —
  // korábban maximumScale:1 + userScalable:false tiltotta.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu" className={inter.variable}>
      <head>
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
          <main className="site-main">
            {/* Teszt-mód jelzés egy helyen, az egész appra — korábban a
                LandingPage és a bejelentkezés is külön renderelte (duplikáció). */}
            <TestModeBanner />
            {children}
          </main>
          <SiteFooter />
          <AiChatWidget />
          <CookieConsentBanner />
        </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
