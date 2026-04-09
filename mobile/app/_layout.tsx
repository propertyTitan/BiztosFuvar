// Expo Router root layout – stack navigáció magyar címekkel.
//
// A hub képernyőn BAL felül: Kilépés gomb (nincs vissza amúgy se)
//                 JOBB felül: Értesítések csengő, olvasatlan piros ponttal
// Minden más képernyő fejlécében csak a natív vissza gomb van — nincs
// kilépés, hogy véletlenül ne nyomja meg senki.
import { useEffect, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { colors } from '@/theme';
import { clearCurrentUser, getCurrentUser } from '@/auth';
import { api } from '@/api';
import { getSocket, joinUserRoom } from '@/socket';
import { ToastProvider } from '@/components/ToastProvider';

function LogoutButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={async () => {
        await clearCurrentUser();
        router.replace('/');
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
 */
function NotificationBellButton() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      const u = await getCurrentUser();
      if (!u) return;
      try {
        const r = await api.unreadNotificationCount();
        setUnread(r.count);
      } catch {}
      joinUserRoom(u.id);
      const socket = getSocket();
      const onNew = () => setUnread((c) => c + 1);
      socket.on('notification:new', onNew);
      cleanup = () => socket.off('notification:new', onNew);
    })();
    return () => cleanup?.();
  }, []);

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

export default function RootLayout() {
  return (
    <ToastProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
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
        <Stack.Screen name="ertesitesek" options={{ title: 'Értesítések' }} />
        <Stack.Screen name="ai-chat" options={{ title: 'AI Segéd' }} />
        <Stack.Screen name="fizetes-stub" options={{ title: 'Fizetés (STUB)' }} />
        <Stack.Screen name="hirdeteseim" options={{ title: 'Saját hirdetéseim' }} />
        <Stack.Screen name="sajat-fuvaraim" options={{ title: 'Fuvaraim' }} />

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
    </ToastProvider>
  );
}
