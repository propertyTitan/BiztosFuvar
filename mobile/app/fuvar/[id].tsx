// Fuvar részletek + licit feladás + "Fuvar lezárása" gomb (csak in_progress státuszban).
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, Link } from 'expo-router';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

export default function FuvarReszletek() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [bid, setBid] = useState('');

  useEffect(() => {
    api.getJob(id!).then(setJob).catch((e) => Alert.alert('Hiba', e.message));
  }, [id]);

  async function placeBid() {
    try {
      const amount = parseInt(bid, 10);
      if (!amount) return Alert.alert('Adj meg egy összeget');
      await api.placeBid(id!, amount);
      Alert.alert('Sikeres licit', `${amount.toLocaleString('hu-HU')} Ft`);
      setBid('');
    } catch (e: any) {
      Alert.alert('Sikertelen licit', e.message);
    }
  }

  if (!job) return <Text style={{ padding: 24 }}>Betöltés...</Text>;

  const canClose = job.status === 'in_progress';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.status}>Státusz: {hungarianStatus(job.status)}</Text>

      <Section label="Felvétel">
        <Text style={styles.row}>{job.pickup_address}</Text>
      </Section>
      <Section label="Lerakodás">
        <Text style={styles.row}>{job.dropoff_address}</Text>
      </Section>
      <Section label="Részletek">
        <Text style={styles.row}>Távolság: {job.distance_km} km</Text>
        {job.weight_kg && <Text style={styles.row}>Súly: {job.weight_kg} kg</Text>}
        {job.volume_m3 && <Text style={styles.row}>Térfogat: {job.volume_m3} m³</Text>}
        {job.suggested_price_huf && (
          <Text style={[styles.row, { color: colors.primary, fontWeight: '700' }]}>
            Javasolt ár: {job.suggested_price_huf.toLocaleString('hu-HU')} Ft
          </Text>
        )}
      </Section>

      {(job.status === 'pending' || job.status === 'bidding') && (
        <Section label="Licit feladása">
          <TextInput
            style={styles.input}
            placeholder="Ajánlott ár (Ft)"
            keyboardType="number-pad"
            value={bid}
            onChangeText={setBid}
          />
          <Pressable style={styles.cta} onPress={placeBid}>
            <Text style={styles.ctaText}>Licit elküldése</Text>
          </Pressable>
        </Section>
      )}

      {canClose && (
        <Link href={{ pathname: '/fuvar/[id]/lezaras', params: { id: id! } }} asChild>
          <Pressable style={[styles.cta, styles.bigCta]}>
            <Text style={styles.ctaText}>📸 FUVAR LEZÁRÁSA</Text>
          </Pressable>
        </Link>
      )}
    </ScrollView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function hungarianStatus(s: string) {
  return ({
    pending: 'Várakozik', bidding: 'Licitálható', accepted: 'Elfogadva',
    in_progress: 'Folyamatban', delivered: 'Lerakva', completed: 'Lezárva',
    disputed: 'Vitatott', cancelled: 'Lemondva',
  } as Record<string, string>)[s] || s;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  status: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.xs },
  row: { color: colors.text, marginBottom: 2 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 16, marginBottom: spacing.md, backgroundColor: '#fff',
  },
  cta: {
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.md, alignItems: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  bigCta: { paddingVertical: spacing.lg, marginTop: spacing.md },
});
