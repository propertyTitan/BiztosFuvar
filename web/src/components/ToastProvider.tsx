'use client';

// Globális toast rendszer — rövid visszajelzések egy-egy műveletről.
//
// Használat:
//   const toast = useToast();
//   toast.success('Elfogadva');
//   toast.error('Hiba történt');
//   toast.info('Új értesítésed van');
//
// UX A14 (2026-10-08) — a toast eddig a ragadós fejléc FÖLÉ került (top: 16,
// z-index 10000), eltakarta a csengőt és a fiókmenüt; ajánlattételnél két
// egyforma toast pont a hibás mezőt fedte; elfogadáskor három került
// egymásra (hat sornyi szöveggel), és kiszorította a díjkártyát. Most:
//  - asztalon a fejléc ALATT (top: 72 px), mobilon alul, teljes szélességben
//    (a home-indikátor biztonságos sávjával);
//  - egyszerre legfeljebb 2; azonos tartalmú toast nem jön újra, csak az
//    időzítője indul újra;
//  - a cím egy sor, a törzs legfeljebb 2 sor (a felolvasó a teljes szöveget
//    kapja — a levágás csak vizuális);
//  - 44 px-es bezáró gomb, lucide ikonok (a „✓ ✗ 🔔" karakterek helyett).
// A kliensoldali validációs hibák NEM toastként jönnek (fókusz + mező alatti
// üzenet), a nyitott fuvaroldalra szóló értesítés sem ugrik fel (SiteHeader).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CircleAlert, CircleCheck, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
};

type ToastApi = {
  success: (title: string, body?: string) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string) => void;
};

/** Egyszerre ennyi toast látszik — a régebbi kiesik. */
export const TOAST_MAX = 2;

/**
 * Az új toast besorolása (tiszta függvény, unit-tesztelve).
 * Ha azonos fajtájú, című és törzsű toast már látszik, NEM jön újra — a
 * hívó csak az időzítőjét indítja újra (`ismetelt`). Különben a végére kerül,
 * és legfeljebb `max` marad (a legrégebbiek esnek ki).
 */
export function toastSorba(
  elozo: Toast[],
  uj: Toast,
  max: number = TOAST_MAX,
): { lista: Toast[]; ismetelt: Toast | null; kiesett: Toast[] } {
  const azonos = elozo.find((t) => t.kind === uj.kind && t.title === uj.title && (t.body || '') === (uj.body || ''));
  if (azonos) return { lista: elozo, ismetelt: azonos, kiesett: [] };
  const bovitett = [...elozo, uj];
  const kiesett = bovitett.slice(0, Math.max(0, bovitett.length - max));
  return { lista: bovitett.slice(-max), ismetelt: null, kiesett };
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // Fallback, ha egy komponens a provider előtt próbál meghívni — csendben elnyeli
  return {
    success: () => {},
    error: () => {},
    info: () => {},
  };
}

let nextId = 1;

const IKON: Record<ToastKind, React.ReactNode> = {
  success: <CircleCheck size={18} aria-hidden />,
  error: <CircleAlert size={18} aria-hidden />,
  info: <Bell size={18} aria-hidden />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  // A lista legfrissebb állapota a push számára (a setItems callback-je nem
  // adhat vissza mellékhatást), és az időzítők, hogy újraindíthatók legyenek.
  const itemsRef = useRef<Toast[]>([]);
  const idozitok = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const eltavolit = useCallback((id: number) => {
    const t = idozitok.current.get(id);
    if (t) clearTimeout(t);
    idozitok.current.delete(id);
    itemsRef.current = itemsRef.current.filter((x) => x.id !== id);
    setItems(itemsRef.current);
  }, []);

  const idozit = useCallback((toast: Toast) => {
    const regi = idozitok.current.get(toast.id);
    if (regi) clearTimeout(regi);
    const ido = toast.kind === 'error' ? 6000 : 4000;
    idozitok.current.set(toast.id, setTimeout(() => eltavolit(toast.id), ido));
  }, [eltavolit]);

  const push = useCallback((kind: ToastKind, title: string, body?: string) => {
    const uj: Toast = { id: nextId++, kind, title, body };
    const { lista, ismetelt, kiesett } = toastSorba(itemsRef.current, uj);
    if (ismetelt) { idozit(ismetelt); return; }
    for (const k of kiesett) {
      const t = idozitok.current.get(k.id);
      if (t) clearTimeout(t);
      idozitok.current.delete(k.id);
    }
    itemsRef.current = lista;
    setItems(lista);
    idozit(uj);
  }, [idozit]);

  useEffect(() => () => {
    for (const t of idozitok.current.values()) clearTimeout(t);
  }, []);

  // Stabil referencia kell: e provider a teljes app körül van, és több
  // komponens effect-je függ a `toast`-tól — memo nélkül minden toast
  // megjelenés/eltűnés újra-feliratkozást és újra-fetchelést indítana.
  const api: ToastApi = useMemo(() => ({
    success: (title, body) => push('success', title, body),
    error: (title, body) => push('error', title, body),
    info: (title, body) => push('info', title, body),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // Képernyőolvasó: az új toastokat felolvassa a fókusz elvétele
        // nélkül (polite); a hibák role="alert"-et kapnak lentebb
        role="status"
        aria-live="polite"
        className="toast-sav"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : undefined}
            className="toast"
            style={{
              // A *-solid tokenek fehér szöveghez vannak méretezve (WCAG AA 4.5:1).
              // A sima --danger/--success sötét módban világosabb, mert ott
              // SZÖVEGKÉNT kell látszania sötét háttéren — fehér szöveg alatt
              // viszont bukik (a kontraszt-audit 3,8:1-et mért).
              background:
                t.kind === 'success'
                  ? 'var(--success-solid)'
                  : t.kind === 'error'
                  ? 'var(--danger-solid)'
                  : 'var(--primary)',
            }}
          >
            <span className="toast-ikon">{IKON[t.kind]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-cim">{t.title}</div>
              {t.body && <div className="toast-torzs">{t.body}</div>}
            </div>
            <button
              type="button"
              className="toast-bezar"
              aria-label="Értesítés bezárása"
              onClick={() => eltavolit(t.id)}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        ))}
      </div>
      <style>{`
        .toast-sav {
          position: fixed;
          top: 72px;
          right: 16px;
          z-index: 9000;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
          max-width: calc(100vw - 32px);
        }
        .toast {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          color: #fff;
          padding: 10px 6px 10px 14px;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.25);
          min-width: 260px;
          max-width: 380px;
          pointer-events: auto;
          animation: gofuvar-toast-in 0.25s ease-out;
        }
        .toast-ikon { display: flex; padding-top: 1px; flex-shrink: 0; }
        .toast-cim {
          font-weight: 700; font-size: 14px; line-height: 1.4;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .toast-torzs {
          font-size: 13px; opacity: 0.92; margin-top: 2px; line-height: 1.4;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .toast-bezar {
          flex-shrink: 0; width: 44px; height: 44px; margin: -10px 0 -10px 0;
          display: inline-flex; align-items: center; justify-content: center;
          background: transparent; border: none; border-radius: 8px;
          color: inherit; cursor: pointer;
        }
        .toast-bezar:hover { background: rgba(255,255,255,0.15); }
        @media (max-width: 640px) {
          .toast-sav {
            top: auto;
            bottom: calc(16px + env(safe-area-inset-bottom, 0px));
            left: 16px;
            right: 16px;
            max-width: none;
          }
          .toast { min-width: 0; max-width: none; width: 100%; }
        }
        @keyframes gofuvar-toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .toast { animation: none; }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

/**
 * Valós időben érkező értesítésekhez egy kényelmes hook: az adott user
 * saját szobájában `notification:new` eventre feliratkozva minden új
 * értesítéshez egy info toast-ot jelenít meg.
 */
export function useNotificationToasts(enabled: boolean) {
  const toast = useToast();
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    // A socket import async, ezért a cleanup-ot egy külső változóban
    // tároljuk, és a useEffect-ből egy szinkron cleanup-ot adunk vissza.
    // (Korábban a return a .then()-en belül volt → a useEffect undefined
    // cleanup-ot kapott, a listener sosem iratkozott le, és minden mount-on
    // halmozódott → duplikált toast-ok.)
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    import('@/lib/socket').then(({ getSocket }) => {
      if (cancelled) return;
      const socket = getSocket();
      const onNew = (n: any) => {
        toast.info(n.title || 'Új értesítés', n.body || undefined);
      };
      socket.on('notification:new', onNew);
      unsubscribe = () => socket.off('notification:new', onNew);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [enabled, toast]);
}
