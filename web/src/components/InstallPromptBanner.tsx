'use client';

// PWA telepítési prompt — okosabb mint a böngésző default-ja.
//
// Mit csinál:
//   - Android / Chrome / Edge → a `beforeinstallprompt` event-tel
//     egy „Telepítsd a kezdőképernyődre" gombot ajánl
//   - iOS Safari → nincs programatikus telepítés, ezért mutat egy
//     útmutatót: Megosztás gomb → „Főképernyőhöz adás"
//   - Asztali böngészők → nem mutatjuk (nincs értelme)
//   - Ha már fel van telepítve (standalone módban fut) → szintén nem
//   - „Most ne" gomb → 30 napig nem zaklatjuk újra
//
// UX-kör A24 (2026-10-08): eddig 3 másodperccel a betöltés után, MÁR AZ ELSŐ
// LÁTOGATÁSKOR egy ~120 px-es sáv ugrott be a fejléc alá, a dokumentumfolyamba:
// a hero olvasás közben lejjebb csúszott (félrekoppintás), és a landingen, a
// regisztráción és a fuvarfeladáson is megjelent. Most:
//   - csak az első érdemi siker után (feladott fuvar / elküldött ajánlat —
//     `jelolElsoSiker()`), vagy a második munkamenettől,
//   - a fókuszt igénylő oldalakon soha (főoldal, landingek, belépés,
//     fuvarfeladás, fizetés, jogi oldalak),
//   - fix alsó panelként, ami nem tolja el a tartalmat, és csak a
//     süti-döntés után (a két alsó sáv nem rakódhat egymásra),
//   - „Most ne" után 30 napig nem.
// A teszt-mód sáva marad (user-döntés) — a telepítő sáv enged neki.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Share, Smartphone } from 'lucide-react';
import { landingLinks } from '@/lib/landings';
import { useSutiDontesMegvan } from '@/lib/sutiDontes';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const DISMISS_KEY = 'gofuvar_install_dismissed_at';
export const DISMISS_DURATION_DAYS = 30;
/** Hányadik munkamenetnél tart ez a böngésző (localStorage, szám). */
const LATOGATAS_KULCS = 'gofuvar_install_visits';
/** Ebben a fülben már beszámoltuk-e a munkamenetet (sessionStorage). */
const MUNKAMENET_KULCS = 'gofuvar_install_session';
/** Volt-e már érdemi siker (feladott fuvar / elküldött ajánlat). */
const SIKER_KULCS = 'gofuvar_install_eligible';
export const ELSO_SIKER_ESEMENY = 'gofuvar:elso-siker';

/** Ahol a felhasználó épp dönt vagy kitölt — ott a telepítő sáv csak zavar. */
const TILTOTT_UTAK = [
  '/bejelentkezes', '/dashboard/uj-fuvar', '/fizetes', '/fizetes-stub', '/hozasd-el',
  '/aszf', '/adatkezeles', '/bankkartyas-fizetes', '/email-megerositese',
  '/elfelejtett-jelszo', '/jelszo-reset',
];

/** Megjelenhet-e a sáv ezen az oldalon. */
export function telepitoSavOldalonEngedett(ut: string | null | undefined): boolean {
  if (!ut || ut === '/') return false;
  if (TILTOTT_UTAK.some((t) => ut === t || ut.startsWith(`${t}/`))) return false;
  if (landingLinks().some((l) => l.href === ut)) return false;
  return true;
}

/** Időzítés: az első érdemi siker után, vagy a második munkamenettől. */
export function telepitoSavIdozitesOk(munkamenetek: number, sikerVolt: boolean): boolean {
  return sikerVolt || munkamenetek >= 2;
}

/**
 * Az első érdemi siker jelzése (feladott fuvar, elküldött ajánlat) — a
 * sikeres művelet után hívandó. A sáv ettől kezdve (a többi feltétel mellett)
 * megjelenhet, akár ugyanebben a munkamenetben.
 */
export function jelolElsoSiker(): void {
  try { window.localStorage.setItem(SIKER_KULCS, '1'); } catch { /* tiltott tároló */ }
  window.dispatchEvent(new Event(ELSO_SIKER_ESEMENY));
}

function olvas(kulcs: string, tarolo: 'local' | 'session'): string | null {
  try {
    return (tarolo === 'local' ? window.localStorage : window.sessionStorage).getItem(kulcs);
  } catch {
    return null;
  }
}
function ir(kulcs: string, ertek: string, tarolo: 'local' | 'session'): void {
  try {
    (tarolo === 'local' ? window.localStorage : window.sessionStorage).setItem(kulcs, ertek);
  } catch { /* tiltott tároló: a sáv egyszerűen nem jelenik meg */ }
}

export default function InstallPromptBanner() {
  const ut = usePathname();
  const sutiDontes = useSutiDontesMegvan();
  const [platform, setPlatform] = useState<'android' | 'ios' | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [idozites, setIdozites] = useState(false);
  const [elrejtve, setElrejtve] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Ha már standalone módban fut, nem kell prompt
    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Ha 30 napon belül elutasította, ne zaklassuk
    const dismissedAt = olvas(DISMISS_KEY, 'local');
    if (dismissedAt) {
      const days = (Date.now() - Number(dismissedAt)) / (1000 * 60 * 60 * 24);
      if (days < DISMISS_DURATION_DAYS) return;
    }

    const ua = window.navigator.userAgent.toLowerCase();
    const isMobile = /android|iphone|ipad|ipod/.test(ua);
    if (!isMobile) return; // asztalin ne zaklassuk

    // Munkamenet-számlálás: fülenként egyszer
    let munkamenetek = Number(olvas(LATOGATAS_KULCS, 'local')) || 0;
    if (!olvas(MUNKAMENET_KULCS, 'session')) {
      munkamenetek += 1;
      ir(LATOGATAS_KULCS, String(munkamenetek), 'local');
      ir(MUNKAMENET_KULCS, '1', 'session');
    }
    const frissitIdozites = () =>
      setIdozites(telepitoSavIdozitesOk(munkamenetek, olvas(SIKER_KULCS, 'local') === '1'));
    frissitIdozites();
    window.addEventListener(ELSO_SIKER_ESEMENY, frissitIdozites);
    setElrejtve(false);

    const isIOS = /iphone|ipad|ipod/.test(ua);
    if (isIOS) {
      setPlatform('ios');
      return () => window.removeEventListener(ELSO_SIKER_ESEMENY, frissitIdozites);
    }

    // Android Chrome — várjuk a beforeinstallprompt eventet
    setPlatform('android');
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener(ELSO_SIKER_ESEMENY, frissitIdozites);
    };
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'dismissed') ir(DISMISS_KEY, String(Date.now()), 'local');
  }

  function dismiss() {
    ir(DISMISS_KEY, String(Date.now()), 'local');
    setElrejtve(true);
  }

  const platformKesz = platform === 'ios' || (platform === 'android' && deferredPrompt !== null);
  if (elrejtve || !platformKesz || !idozites || !sutiDontes || !telepitoSavOldalonEngedett(ut)) return null;

  return (
    <div className="telepito-panel" role="region" aria-label="Telepítés a kezdőképernyőre">
      <Smartphone size={24} aria-hidden style={{ flexShrink: 0 }} />
      <div style={{ flex: '1 1 200px', lineHeight: 1.4 }}>
        {platform === 'android' ? (
          <>
            <strong>Telepítsd a GoFuvart!</strong>
            <br />
            <span style={{ fontSize: 13, opacity: 0.95 }}>
              Egy kattintással a kezdőképernyődre — app-érzettel.
            </span>
          </>
        ) : (
          <>
            <strong>Tedd ki a GoFuvart a kezdőképernyődre!</strong>
            <br />
            <span style={{ fontSize: 13, opacity: 0.95 }}>
              Nyomd meg a Megosztás gombot{' '}
              <Share size={14} aria-hidden style={{ verticalAlign: -2 }} />,
              majd a <em>„Főképernyőhöz adás"</em> opciót.
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
              // literál: a fehér gombon sötétben is olvasható maradjon
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
            border: '1px solid rgba(255,255,255,0.6)',
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
