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
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

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

  const api: ToastApi = {
    success: (title, body) => push('success', title, body),
    error: (title, body) => push('error', title, body),
    info: (title, body) => push('info', title, body),
  };

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
                  ? '#16a34a'
                  : t.kind === 'error'
                  ? '#dc2626'
                  : '#1e40af',
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
    // Dinamikusan importáljuk a socket-et (csak a böngészőben)
    import('@/lib/socket').then(({ getSocket }) => {
      const socket = getSocket();
      const onNew = (n: any) => {
        toast.info(n.title || 'Új értesítés', n.body || undefined);
      };
      socket.on('notification:new', onNew);
      return () => socket.off('notification:new', onNew);
    });
  }, [enabled, toast]);
}
