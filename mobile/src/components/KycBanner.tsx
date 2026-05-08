// KYC nudge banner — minden olyan képernyőn ugyanazt mutatja, ahol érdemes.
//
// Önállóan tölti be a státuszt a `/kyc/me`-ből. Ha verified és nem közelíti
// a lejárat → semmit nem renderel (return null), így nyugodtan beilleszthető
// a hubba és a profilba is anélkül, hogy fent rontaná a layoutot.
//
// Variantok:
//   - `compact`: keskeny kártya, hub tetejére
//   - `card`:    nagyobb info-doboz, profil oldalra
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { api, KycMe } from '@/api';
import { colors, spacing, radius, typography, shadows } from '@/theme';

type Variant = 'compact' | 'card';

type Tone = 'warn' | 'danger' | 'info' | 'success';

type Cta = {
  tone: Tone;
  emoji: string;
  title: string;
  body: string;
  action: string;
};

// 30 napos „közelít a lejárat" küszöb — csak akkor mutatunk warningot
// verified user-nek, ha tényleg releváns.
const EXPIRY_WARN_DAYS = 30;

function ctaFor(kyc: KycMe | null): Cta | null {
  if (!kyc) return null;

  const status = kyc.kyc_status;
  const docStatus = kyc.document?.status;

  if (status === 'verified') {
    if (kyc.license_expiry) {
      const days = Math.floor(
        (new Date(kyc.license_expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      if (days < 0) {
        return {
          tone: 'danger',
          emoji: '🚫',
          title: 'A jogosítványod lejárt',
          body: 'A licitálás letiltva, amíg fel nem töltesz egy érvényes jogosítványt.',
          action: 'Új jogosítvány feltöltése',
        };
      }
      if (days <= 7) {
        return {
          tone: 'danger',
          emoji: '🔴',
          title: `Jogosítványod ${days} napon belül lejár`,
          body: 'Ha nem frissíted, a lejárat napján automatikusan letiltjuk a licitálást.',
          action: 'Frissítés',
        };
      }
      if (days <= EXPIRY_WARN_DAYS) {
        return {
          tone: 'warn',
          emoji: '⚠️',
          title: `Jogosítványod ${days} napon belül lejár`,
          body: 'Érdemes hamarosan frissíteni, hogy ne álljon meg a licitálás.',
          action: 'Frissítés',
        };
      }
    }
    return null;
  }

  if (status === 'pending' || docStatus === 'pending') {
    return {
      tone: 'info',
      emoji: '⏳',
      title: 'Jogosítványod ellenőrzés alatt',
      body: 'Az adminok rövidesen átnézik. Erről értesítést kapsz.',
      action: 'Részletek',
    };
  }

  if (docStatus === 'rejected') {
    return {
      tone: 'danger',
      emoji: '⚠️',
      title: 'A feltöltött jogosítvány elutasítva',
      body: kyc.document?.rejection_reason
        ? `Indok: ${kyc.document.rejection_reason}`
        : 'Kérjük tölts fel egy másik képet.',
      action: 'Új feltöltés',
    };
  }

  // status === 'none' (vagy 'suspended') — alap nudge
  return {
    tone: 'warn',
    emoji: '🪪',
    title: 'Hitelesítsd magad',
    body: 'A licitáláshoz töltsd fel a jogosítványod fotóját. ~1 perc.',
    action: 'Hitelesítés indítása',
  };
}

const TONE_STYLES: Record<Tone, { bg: string; border: string; text: string }> = {
  warn:    { bg: colors.warningLight, border: colors.warning,  text: '#92400E' },
  danger:  { bg: colors.dangerLight,  border: colors.danger,   text: '#991B1B' },
  info:    { bg: colors.primarySubtle, border: colors.primary, text: colors.primaryDark },
  success: { bg: colors.successLight, border: colors.success,  text: '#166534' },
};

export default function KycBanner({ variant = 'compact' }: { variant?: Variant }) {
  const router = useRouter();
  const [kyc, setKyc] = useState<KycMe | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.getKycStatus();
      setKyc(r);
    } catch {
      // Csendben — KYC banner sose blokkolja a screen-t.
      setKyc(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  if (loading && variant === 'card') {
    return (
      <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const cta = ctaFor(kyc);
  if (!cta) return null;

  const tone = TONE_STYLES[cta.tone];
  const onPress = () => router.push('/kyc' as any);

  if (variant === 'compact') {
    return (
      <Pressable
        onPress={onPress}
        style={[
          styles.compact,
          { backgroundColor: tone.bg, borderLeftColor: tone.border },
        ]}
      >
        <Text style={styles.compactEmoji}>{cta.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.compactTitle, { color: tone.text }]} numberOfLines={1}>
            {cta.title}
          </Text>
          <Text style={[styles.compactBody, { color: tone.text }]} numberOfLines={2}>
            {cta.body}
          </Text>
        </View>
        <Text style={[styles.compactArrow, { color: tone.text }]}>→</Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tone.bg, borderColor: tone.border },
      ]}
    >
      <Text style={styles.cardEmoji}>{cta.emoji}</Text>
      <Text style={[styles.cardTitle, { color: tone.text }]}>{cta.title}</Text>
      <Text style={[styles.cardBody, { color: tone.text }]}>{cta.body}</Text>
      <Pressable onPress={onPress} style={[styles.cardBtn, { backgroundColor: tone.border }]}>
        <Text style={styles.cardBtnText}>{cta.action} →</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 4,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  compactEmoji: { fontSize: 24 },
  compactTitle: { ...typography.h3, fontSize: 14 },
  compactBody: { ...typography.bodySmall, marginTop: 2 },
  compactArrow: { fontSize: 22, fontWeight: '800' },

  card: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  cardEmoji: { fontSize: 32, marginBottom: spacing.xs },
  cardTitle: { ...typography.h2, marginBottom: 4 },
  cardBody: { ...typography.body, marginBottom: spacing.md },
  cardBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  cardBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
