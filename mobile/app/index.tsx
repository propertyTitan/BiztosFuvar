// Nyitóképernyő – ha van bejelentkezett user, átirányít a role-alapú kezdőoldalra.
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { colors, spacing, radius } from '@/theme';
import { getCurrentUser } from '@/auth';
import { LogoHorizontal } from '@/components/Logo';

export default function Index() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (user) {
        router.replace('/hub');
      } else {
        setChecking(false);
      }
    })();
  }, []);

  if (checking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={{ marginBottom: spacing.lg }}>
        <LogoHorizontal size="lg" />
      </View>
      <Text style={styles.tagline}>
        Magyarország közösségi fuvartőzsdéje.{'\n'}Bizalom. Fotó. Kód. Letét.
      </Text>

      <Link href="/bejelentkezes" asChild>
        <Pressable style={styles.cta}>
          <Text style={styles.ctaText}>Bejelentkezés</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center' },
  tagline: {
    textAlign: 'center',
    color: colors.textMuted,
    marginBottom: spacing.xl,
    fontSize: 16,
  },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
