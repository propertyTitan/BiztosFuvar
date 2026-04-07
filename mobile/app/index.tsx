// Nyitóképernyő – egyszerű brand + belépés gomb.
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { colors, spacing, radius } from '@/theme';

export default function Index() {
  return (
    <View style={styles.container}>
      <Text style={styles.brand}>BiztosFuvar</Text>
      <Text style={styles.tagline}>Magyarország közösségi fuvartőzsdéje.{'\n'}Bizalom. Fotó. GPS. Letét.</Text>

      <Link href="/bejelentkezes" asChild>
        <Pressable style={styles.cta}>
          <Text style={styles.ctaText}>Bejelentkezés</Text>
        </Pressable>
      </Link>

      <Link href="/fuvarok" asChild>
        <Pressable style={[styles.cta, styles.ctaSecondary]}>
          <Text style={[styles.ctaText, { color: colors.primary }]}>Fuvarok böngészése</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, justifyContent: 'center', alignItems: 'center' },
  brand: { fontSize: 42, fontWeight: '800', color: colors.primary, marginBottom: spacing.sm },
  tagline: { textAlign: 'center', color: colors.textMuted, marginBottom: spacing.xl, fontSize: 16 },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  ctaSecondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
