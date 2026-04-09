// Expo Router root layout – stack navigáció magyar címekkel.
// Header-jobb oldalán: "Kijelentkezés" gomb a bejelentkezett user számára.
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text } from 'react-native';
import { colors } from '@/theme';
import { clearCurrentUser } from '@/auth';

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

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.primary },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.background },
          headerRight: () => <LogoutButton />,
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: 'GoFuvar', headerRight: undefined }}
        />
        <Stack.Screen
          name="bejelentkezes"
          options={{ title: 'Bejelentkezés', headerRight: undefined }}
        />

        {/* Hub — mindenkinek a kezdőoldala login után */}
        <Stack.Screen name="hub" options={{ title: 'GoFuvar' }} />
        <Stack.Screen name="ertesitesek" options={{ title: 'Értesítések' }} />
        <Stack.Screen name="ai-chat" options={{ title: 'AI Segéd' }} />
        <Stack.Screen name="hirdeteseim" options={{ title: 'Saját hirdetéseim' }} />
        <Stack.Screen name="sajat-fuvaraim" options={{ title: 'Fuvaraim' }} />

        {/* Sofőr nézet */}
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
    </>
  );
}
