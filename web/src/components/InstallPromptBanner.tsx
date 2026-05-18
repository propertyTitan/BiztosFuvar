'use client';

// PWA telepítési prompt — okosabb mint a böngésző default-ja.
//
// Mit csinál:
//   - Android / Chrome / Edge → a `beforeinstallprompt` event-tel
//     egy szép „Telepítsd a kezdőképernyődre" gombot ajánl
//   - iOS Safari → nincs programatikus telepítés, ezért mutat egy
//     útmutatót: "Tap the Share button → Add to Home Screen"
//   - Asztali böngészők → nem mutatjuk (nincs értelme)
//   - Ha már fel van telepítve (standalone módban fut) → szintén nem
//   - „Most ne" gomb → 7 napig nem zaklatjuk újra
//
// Cél: a user webből is „app-érzettel" használhatja, amíg a natív app
// (App Store + Play Store) megérkezik.

import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'gofuvar_install_dismissed_at';
const DISMISS_DURATION_DAYS = 7;

export default function InstallPromptBanner() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Ha már standalone módban fut, nem kell prompt
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Ha 7 napon belül elutasította, ne zaklassuk
    const dismissedAt = window.localStorage.getItem(DISMISS_KEY);
    if (dismissedAt) {
      const days = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (days < DISMISS_DURATION_DAYS) return;
    }

    const ua = window.navigator.userAgent.toLowerCase();
    const isMobile = /android|iphone|ipad|ipod/.test(ua);
    if (!isMobile) return; // asztalin ne zaklassuk

    const isIOS = /iphone|ipad|ipod/.test(ua);
    const isAndroid = /android/.test(ua);

    if (isIOS) {
      // iOS-en nincs prompt — 3 másodperc után mutatjuk az útmutatót
      setPlatform('ios');
      const t = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(t);
    }

    if (isAndroid) {
      // Android Chrome — várjuk a beforeinstallprompt eventet
      setPlatform('android');
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setShow(true);
      };
      window.addEventListener('beforeinstallprompt', handler);
      return () => window.removeEventListener('beforeinstallprompt', handler);
    }
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShow(false);
    if (outcome === 'dismissed') {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    }
  }

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)',
        color: '#fff',
        padding: '12px 16px',
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 22 }}>📱</span>
      <div style={{ flex: '1 1 200px', lineHeight: 1.4 }}>
        {platform === 'android' ? (
          <>
            <strong>Telepítsd a GoFuvar-t!</strong>
            <br />
            <span style={{ fontSize: 13, opacity: 0.95 }}>
              Egy kattintással a kezdőképernyődre — app-érzettel.
            </span>
          </>
        ) : (
          <>
            <strong>Telepítsd a GoFuvar-t a kezdőképernyődre!</strong>
            <br />
            <span style={{ fontSize: 13, opacity: 0.95 }}>
              Nyomd meg a Megosztás gombot (
              <span style={{ display: 'inline-block', padding: '0 4px' }}>⬆</span>
              ), majd a <em>„Főképernyőhöz adás"</em> opciót.
            </span>
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {platform === 'android' && deferredPrompt && (
          <button
            type="button"
            onClick={handleInstall}
            style={{
              padding: '8px 14px',
              background: '#fff',
              color: '#1e40af',
              border: 'none',
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Telepítés
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          style={{
            padding: '8px 12px',
            background: 'transparent',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: 6,
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Most ne
        </button>
      </div>
    </div>
  );
}
