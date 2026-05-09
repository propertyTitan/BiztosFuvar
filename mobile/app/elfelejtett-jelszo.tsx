// Elfelejtett jelszó űrlap mobilon. A tényleges reset a webes oldalon
// történik (a user a kapott emailben oda kattint).
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

export default function ElfelejtettJelszo() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (!email) return;
    setLoading(true);
    try {
      const r = await api.forgotPassword(email);
      setMessage(r.message);
      setSubmitted(true);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Elfelejtett jelszó</Text>
      <Text style={styles.muted}>
        Add meg az email címed és küldünk egy linket a jelszó visszaállításához.
      </Text>

      {submitted ? (
        <View style={styles.successCard}>
          <Text style={styles.successTitle}>📧 Ellenőrizd a postaládád!</Text>
          <Text style={styles.successText}>{message}</Text>
          <Pressable
            onPress={() => router.replace('/bejelentkezes')}
            style={[styles.cta, { marginTop: spacing.md }]}
          >
            <Text style={styles.ctaText}>Vissza a bejelentkezéshez</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.label}>Email cím</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="te@example.com"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
            autoFocus
          />

          <Pressable
            style={[styles.cta, (loading || !email) && { opacity: 0.5 }]}
            onPress={onSubmit}
            disabled={loading || !email}
          >
            <Text style={styles.ctaText}>{loading ? 'Küldés…' : 'Reset link küldése'}</Text>
          </Pressable>

          <Pressable
            onPress={() => router.back()}
            style={{ alignSelf: 'center', marginTop: spacing.md, padding: 8 }}
          >
            <Text style={{ color: colors.primary, fontWeight: '600' }}>← Vissza</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: 4 },
  muted: { color: colors.textMuted, fontSize: 14, marginBottom: spacing.lg },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: colors.text,
    backgroundColor: colors.surface, marginBottom: spacing.md,
  },
  cta: {
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radius.sm,
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  successCard: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#16a34a',
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  successTitle: { fontSize: 16, fontWeight: '800', color: '#14532d', marginBottom: 8 },
  successText: { fontSize: 14, color: '#14532d', lineHeight: 20 },
});
