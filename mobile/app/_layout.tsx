// Expo Router root layout – stack navigáció magyar címekkel.
//
// A hub képernyőn BAL felül: Kilépés gomb (nincs vissza amúgy se)
//                 JOBB felül: Értesítések csengő, olvasatlan piros ponttal
// Minden más képernyő fejlécében csak a natív vissza gomb van — nincs
// kilépés, hogy véletlenül ne nyomja meg senki.
import { useCallback, useEffect, useState } from 'react';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DeviceEventEmitter, Pressable, Text, View, StyleSheet } from 'react-native';
import { colors } from '@/theme';
import { AUTH_EVENT, clearCurrentUser, getCurrentUser } from '@/auth';
import { api } from '@/api';
import { getSocket, joinUserRoom, disconnectSocket } from '@/socket';
import { ToastProvider, useToast } from '@/components/ToastProvider';
import BottomTabBar from '@/components/BottomTabBar';

function LogoutButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={async () => {
        // 1) Töröljük a tárolt usert/token-t.
        await clearCurrentUser();
        // 2) Bontjuk a Socket.IO kapcsolatot, hogy a következő login
        //    teljesen friss sessiont kapjon (nincs régi szoba, nincs
        //    halmozódó listener).
        disconnectSocket();
        // 3) Egyenesen a login űrlapra megyünk — a welcome screen
        //    (index) lépés-felesleges, és félrevezető, ha a user csak
        //    profilt akar váltani.
        router.replace('/bejelentkezes');
      }}
      style={{ paddingHorizontal: 12, paddingVertical: 6 }}
      hitSlop={8}
    >
      <Text style={{ color: '#fff', fontWeight: '600' }}>Kilépés</Text>
    </Pressable>
  );
}

/**
 * Értesítések csengő a hub jobb oldalán. Piros pötty jelenik meg a
 * sarkon, ha van olvasatlan értesítés. Real-time frissül Socket.IO-n.
 *
 * A `useFocusEffect` biztosítja, hogy minden alkalommal, amikor a hub
 * fókuszba kerül (beleértve a profilváltás utáni visszatérést is),
 * a badge az AKTUÁLIS user-re frissüljön — nem marad ott az előző
 * felhasználó olvasatlan száma.
 */
function NotificationBellButton() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cleanup: (() => void) | undefined;
      let cancelled = false;
      (async () => {
        const u = await getCurrentUser();
        if (!u || cancelled) {
          setUnread(0);
          return;
        }
        try {
          const r = await api.unreadNotificationCount();
          if (!cancelled) setUnread(r.count);
        } catch {}
        joinUserRoom(u.id);
        const socket = getSocket();
        const onNew = () => setUnread((c) => c + 1);
        socket.on('notification:new', onNew);
        cleanup = () => socket.off('notification:new', onNew);
      })();
      return () => {
        cancelled = true;
        cleanup?.();
      };
    }, []),
  );

  return (
    <Pressable
      onPress={() => router.push('/ertesitesek')}
      style={{ paddingHorizontal: 12, paddingVertical: 6 }}
      hitSlop={8}
    >
      <View>
        <Text style={{ fontSize: 22 }}>🔔</Text>
        {unread > 0 && (
          <View
            style={{
              position: 'absolute',
              top: -2,
              right: -6,
              backgroundColor: '#ef4444',
              borderRadius: 999,
              minWidth: 16,
              paddingHorizontal: 4,
              paddingVertical: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: colors.primary,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
              {unread > 99 ? '99+' : String(unread)}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

/**
 * GLOBÁLIS notifikáció → toast híd.
 *
 * Minden bejövő `notification:new` esemény egy felpattanó buborékot
 * is kiad a képernyő tetején — ne csak a harang számlálóján vegye
 * észre a user. A komponens a ToastProvider-en belül van mountolva,
 * egyszer az egész app élettartamára, és profilváltáskor (AUTH_EVENT)
 * magától újra feliratkozik az új socket kapcsolatra.
 *
 * Ez miatt kell a `useToast`-os belső hook, hogy az egész app minden
 * képernyőjén működjenek a toast-ok, nem csak a hub-on ahol a
 * NotificationBellButton él.
 */
function NotificationToastBridge() {
  const toast = useToast();

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    async function setup() {
      cleanup?.();
      cleanup = undefined;
      const u = await getCurrentUser();
      if (!u || cancelled) return;
      joinUserRoom(u.id);
      const socket = getSocket();
      const onNew = (n: any) => {
        const kind: 'success' | 'error' | 'info' =
          n?.type === 'booking_paid' || n?.type === 'booking_confirmed'
            ? 'success'
            : n?.type === 'booking_rejected'
            ? 'error'
            : 'info';
        toast[kind](n?.title || 'Új értesítés', n?.body || undefined);
      };
      socket.on('notification:new', onNew);
      cleanup = () => socket.off('notification:new', onNew);
    }

    // Első mount → próbáljuk meg a setup-ot, és feliratkozunk az
    // AUTH_EVENT-re, hogy login/logout után friss socketre rakjuk a
    // listenert.
    setup();
    const sub = DeviceEventEmitter.addListener(AUTH_EVENT, () => {
      setup();
    });

    return () => {
      cancelled = true;
      sub.remove();
      cleanup?.();
    };
  }, [toast]);

  return null;
}

export default function RootLayout() {
  return (
    <ToastProvider>
      <NotificationToastBridge />
      <StatusBar style="light" />
      <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="index" options={{ title: 'GoFuvar' }} />
        <Stack.Screen name="bejelentkezes" options={{ title: 'Bejelentkezés' }} />

        {/* Hub — Kilépés balra, Értesítések csengő jobbra */}
        <Stack.Screen
          name="hub"
          options={{
            title: 'GoFuvar',
            headerBackVisible: false,
            headerLeft: () => <LogoutButton />,
            headerRight: () => <NotificationBellButton />,
          }}
        />
        <Stack.Screen name="profil" options={{ title: 'Profil' }} />
        <Stack.Screen name="user-profil" options={{ title: 'Felhasználó profil' }} />
        <Stack.Screen name="ertesitesek" options={{ title: 'Értesítések' }} />
        <Stack.Screen name="ai-chat" options={{ title: 'AI Segéd' }} />
        <Stack.Screen name="fizetes-stub" options={{ title: 'Fizetés (STUB)' }} />
        <Stack.Screen name="hirdeteseim" options={{ title: 'Saját hirdetéseim' }} />
        <Stack.Screen name="sajat-fuvaraim" options={{ title: 'Saját fuvarjaim' }} />

        {/* Sofőr / licit nézet */}
        <Stack.Screen name="fuvarok" options={{ title: 'Elérhető fuvarok' }} />
        <Stack.Screen name="licitjeim" options={{ title: 'Licitjeim' }} />
        <Stack.Screen name="fuvar/[id]" options={{ title: 'Fuvar részletek' }} />
        <Stack.Screen
          name="fuvar/[id]/lezaras"
          options={{ title: 'Fuvar lezárása', presentation: 'modal' }}
        />
        <Stack.Screen name="utvonalaim" options={{ title: 'Útvonalaim' }} />
        <Stack.Screen name="uj-utvonal" options={{ title: 'Új útvonal' }} />
        <Stack.Screen name="utvonal/[id]" options={{ title: 'Útvonal részletek' }} />

        {/* Feladó nézet */}
        <Stack.Screen name="feladas/sajat" options={{ title: 'Fuvaraim' }} />
        <Stack.Screen name="feladas/uj" options={{ title: 'Új fuvar feladása' }} />
        <Stack.Screen name="feladas/[id]" options={{ title: 'Fuvar részletek' }} />
        <Stack.Screen name="feladas/utvonalak" options={{ title: 'Útba eső sofőrök' }} />
        <Stack.Screen name="feladas/utvonal/[id]" options={{ title: 'Útvonal' }} />
        <Stack.Screen name="feladas/foglalasaim" options={{ title: 'Foglalásaim' }} />
      </Stack>
      <BottomTabBar />
      </View>
    </ToastProvider>
  );
}
