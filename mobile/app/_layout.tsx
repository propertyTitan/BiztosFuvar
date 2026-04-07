// Expo Router root layout – stack navigáció magyar címekkel.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@/theme';

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
        }}
      >
        <Stack.Screen name="index" options={{ title: 'BiztosFuvar' }} />
        <Stack.Screen name="bejelentkezes" options={{ title: 'Bejelentkezés' }} />
        <Stack.Screen name="fuvarok" options={{ title: 'Elérhető fuvarok' }} />
        <Stack.Screen name="fuvar/[id]" options={{ title: 'Fuvar részletek' }} />
        <Stack.Screen
          name="fuvar/[id]/lezaras"
          options={{ title: 'Fuvar lezárása', presentation: 'modal' }}
        />
      </Stack>
    </>
  );
}
