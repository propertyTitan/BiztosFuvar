'use client';

// Globális toast rendszer — egyszerű "buborék" értesítések a képernyő tetején.
//
// Használat:
//   const toast = useToast();
//   toast.success('Elfogadva');
//   toast.error('Hiba történt');
//   toast.info('Új értesítésed van');
//
// A <ToastProvider> komponens a layout.tsx-ben van wrappelve a gyerekek
// köré. A buborékok jobb oldalt fent jelennek meg, egymás alatt, és 4
// másodperc után automatikusan eltűnnek (az `error`-ok egy kicsit
// tovább, 6 mp-ig).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';

type Toast = {
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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((kind: ToastKind, title: string, body?: string) => {
    const id = nextId++;
    setItems((prev) => [...prev, { id, kind, title, body }]);
    // Automatikus eltüntetés
    const timeout = kind === 'error' ? 6000 : 4000;
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, timeout);
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
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          zIndex: 10000,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
          maxWidth: 'calc(100vw - 32px)',
        }}
      >
        {items.map((t) => (
          <div
            key={t.id}
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
            style={{
              background:
                t.kind === 'success'
                  ? 'var(--success)'
                  : t.kind === 'error'
                  ? 'var(--danger)'
                  : 'var(--primary)',
              color: '#fff',
              padding: '12px 16px',
              borderRadius: 10,
              boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
              minWidth: 260,
              maxWidth: 360,
              pointerEvents: 'auto',
              cursor: 'pointer',
              animation: 'gofuvar-toast-in 0.25s ease-out',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {t.kind === 'success' && '✓ '}
              {t.kind === 'error' && '✗ '}
              {t.kind === 'info' && '🔔 '}
              {t.title}
            </div>
            {t.body && (
              <div style={{ fontSize: 13, opacity: 0.92, marginTop: 4 }}>{t.body}</div>
            )}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes gofuvar-toast-in {
          from { opacity: 0; transform: translateX(40px); }
          to   { opacity: 1; transform: translateX(0); }
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
