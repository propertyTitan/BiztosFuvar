// Globális Next.js layout – magyar nyelv, GoFuvar branding.
// PWA-ként telepíthető — manifest.webmanifest + apple-touch-icon meta-k
// gondoskodnak róla, hogy a user a kezdőképernyőjére telepíthesse a
// böngészőjéből, így „app-érzettel" használhatja a natív app megjelenéséig.
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter, Bricolage_Grotesque } from 'next/font/google';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import AiChatWidget from '@/components/AiChatWidget';
import EmailVerifyGate from '@/components/EmailVerifyGate';
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

// Display-betű a címsorokra: karaktert ad a márkának, míg a szövegtörzs
// és a UI Inter marad (olvashatóság!). latin-ext a magyar ő/ű miatt.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  weight: ['700', '800'],
  variable: '--font-display',
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
    'Hirdess meg egy fuvart és a sofőrök ajánlatot tesznek rá, vagy foglalj helyet egy útba eső sofőr fix áras útvonalán. A fuvardíjat készpénzben fizeted a sofőrnek — a platformdíj bevezető áron 500 Ft-tól. Fotó bizonyíték, 6 jegyű átvételi kód, SMS-értesítés a címzettnek. Ingyenes regisztráció.',
  keywords: [
    'fuvar', 'szállítás', 'csomag', 'költöztetés', 'sofőr', 'fuvartőzsde',
    'GoFuvar', 'közösségi szállítás', 'árajánlat', 'fix áras fuvar',
    'készpénzes fuvar', 'Magyarország',
  ],
  metadataBase: new URL('https://gofuvar.hu'),
  openGraph: {
    title: 'GoFuvar – Közösségi fuvartőzsde',
    description: 'Csomagod van? Sofőröd is lesz. Biztonságos fizetés, fotó bizonyíték, 6 jegyű átvételi kód.',
    type: 'website',
    locale: 'hu_HU',
    siteName: 'GoFuvar',
    // Megosztáskor (Facebook/Messenger — a fő marketing-csatorna!) ez a
    // kép jelenik meg a link mellett. 1200×630, Playwrighttal renderelve.
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'GoFuvar – Csomagod van? Sofőröd is lesz.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GoFuvar – Közösségi fuvartőzsde',
    description: 'Csomagod van? Sofőröd is lesz. Készpénzes fizetés a sofőrnek, 6 jegyű átvételi kód.',
    images: ['/og-image.png'],
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
    <html lang="hu" className={`${inter.variable} ${bricolage.variable}`}>
      <head>
        {/* iOS Safari PWA-támogatás (a Next.js metadata API nem mindig
            generálja ezeket konzisztensen, ezért explicit kihúzzuk) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="GoFuvar" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="application-name" content="GoFuvar" />
        {/* Structured data (JSON-LD) a keresőknek: ki üzemelteti az oldalt
            és mi ez a szolgáltatás. A cégadatok az ÁSZF-fel egyeznek. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@graph': [
                {
                  '@type': 'Organization',
                  '@id': 'https://gofuvar.hu/#org',
                  name: 'GoFuvar',
                  legalName: 'Tiszta Hód Korlátolt Felelősségű Társaság',
                  url: 'https://gofuvar.hu',
                  logo: 'https://gofuvar.hu/og-image.png',
                  email: 'info@gofuvar.hu',
                  telephone: '+36203979223',
                  address: {
                    '@type': 'PostalAddress',
                    streetAddress: 'Szántó Kovács János utca 144.',
                    postalCode: '6800',
                    addressLocality: 'Hódmezővásárhely',
                    addressCountry: 'HU',
                  },
                },
                {
                  '@type': 'WebSite',
                  '@id': 'https://gofuvar.hu/#website',
                  url: 'https://gofuvar.hu',
                  name: 'GoFuvar – Magyarország közösségi fuvartőzsdéje',
                  publisher: { '@id': 'https://gofuvar.hu/#org' },
                  inLanguage: 'hu-HU',
                },
              ],
            }),
          }}
        />
      </head>
      <body>
        <noscript>
          <div style={{ padding: 24, textAlign: 'center', fontFamily: 'sans-serif' }}>
            A GoFuvar működéséhez JavaScript szükséges. Kérjük, engedélyezd a
            böngésződben, majd töltsd újra az oldalt.
          </div>
        </noscript>
        <I18nProvider>
        <ToastProvider>
          <KycModalProvider />
          <CoverageModal />
          <SiteHeader />
          <EmailVerifyGate />
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
