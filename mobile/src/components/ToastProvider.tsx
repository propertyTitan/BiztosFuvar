// Globális toast rendszer mobilra.
// Ugyanaz az API, mint a webes verzióban (useToast().success/error/info).
// A <ToastProvider>-t a _layout.tsx-ben a Stack köré wrappeljük, így az
// egész app bármelyik komponense kap toast-okat.
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { colors, spacing, radius } from '@/theme';

type ToastKind = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  opacity: Animated.Value;
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
  return { success: () => {}, error: () => {}, info: () => {} };
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => {
      const item = prev.find((t) => t.id === id);
      if (item) {
        Animated.timing(item.opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => {
          setItems((curr) => curr.filter((t) => t.id !== id));
        });
      }
      return prev;
    });
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, title: string, body?: string) => {
      const id = nextId++;
      const opacity = new Animated.Value(0);
      setItems((prev) => [...prev, { id, kind, title, body, opacity }]);
      // Fade in
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
      const duration = kind === 'error' ? 6000 : 4000;
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  const api: ToastApi = {
    success: (title, body) => push('success', title, body),
    error: (title, body) => push('error', title, body),
    info: (title, body) => push('info', title, body),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <View pointerEvents="box-none" style={styles.container}>
        {items.map((t) => (
          <Animated.View
            key={t.id}
            style={[
              styles.toast,
              t.kind === 'success' && { backgroundColor: '#16a34a' },
              t.kind === 'error'   && { backgroundColor: '#dc2626' },
              t.kind === 'info'    && { backgroundColor: colors.primary },
              { opacity: t.opacity },
            ]}
          >
            <Pressable onPress={() => dismiss(t.id)} style={{ flex: 1 }}>
              <Text style={styles.title}>
                {t.kind === 'success' && '✓ '}
                {t.kind === 'error' && '✗ '}
                {t.kind === 'info' && '🔔 '}
                {t.title}
              </Text>
              {t.body ? <Text style={styles.body}>{t.body}</Text> : null}
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    left: 16,
    right: 16,
    zIndex: 10000,
    gap: 8,
  },
  toast: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  title: { color: '#fff', fontWeight: '700', fontSize: 14 },
  body: { color: '#fff', opacity: 0.92, fontSize: 13, marginTop: 4 },
});
