// STUB Barion fizetési képernyő mobilon.
// Az in-app szimulációt mutatja: fejléc, fuvar adatok, összeg, Fizetek most
// gomb. A valódi Barion kapu helyett ez jelenik meg, amíg STUB módban vagyunk.
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

type LoadedData = {
  title: string;
  amount: number;
  pickup: string;
  dropoff: string;
  back: string;
} | null;

export default function FizetesStub() {
  const router = useRouter();
  const toast = useToast();
  const { booking, job } = useLocalSearchParams<{ booking?: string; job?: string }>();

  const [data, setData] = useState<LoadedData>(null);
  const [step, setStep] = useState<'review' | 'processing' | 'done'>('review');

  useEffect(() => {
    (async () => {
      try {
        if (booking) {
          const b = await api.getRouteBooking(booking);
          setData({
            title: b.route_title || 'Sofőri útvonal',
            amount: b.price_huf,
            pickup: b.pickup_address,
            dropoff: b.dropoff_address,
            back: '/feladas/foglalasaim',
          });
        } else if (job) {
          const j = await api.getJob(job);
          setData({
            title: j.title,
            amount: j.accepted_price_huf || j.suggested_price_huf || 0,
            pickup: j.pickup_address,
            dropoff: j.dropoff_address,
            back: `/feladas/${job}`,
          });
        }
      } catch (err: any) {
        Alert.alert('Hiba', err.message);
      }
    })();
  }, [booking, job]);

  function pay() {
    setStep('processing');
    setTimeout(() => {
      setStep('done');
      toast.success(
        'Fizetés sikeres (STUB)',
        data ? `${data.amount.toLocaleString('hu-HU')} Ft lefoglalva` : undefined,
      );
      setTimeout(() => {
        if (data?.back) router.replace(data.back as any);
      }, 2000);
    }, 1500);
  }

  if (!data) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>Betöltés…</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Barion-stílusú fejléc */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Text style={{ fontSize: 22 }}>💳</Text>
        </View>
        <View>
          <Text style={styles.headerTitle}>Barion fizetés</Text>
          <Text style={styles.headerSubtitle}>STUB – teszt mód</Text>
        </View>
      </View>

      <View style={styles.card}>
        {step === 'review' && (
          <>
            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.label}>FUVAR</Text>
              <Text style={styles.value}>{data.title}</Text>
            </View>

            <View style={{ marginBottom: spacing.md }}>
              <Text style={styles.label}>CÍMEK</Text>
              <Text style={styles.row}>📍 {data.pickup}</Text>
              <Text style={styles.row}>🏁 {data.dropoff}</Text>
            </View>

            <View style={styles.amountBox}>
              <Text style={styles.amountLabel}>FIZETENDŐ ÖSSZEG</Text>
              <Text style={styles.amountValue}>
                {data.amount.toLocaleString('hu-HU')} Ft
              </Text>
            </View>

            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️ Ez egy STUB fizetési képernyő — valódi Barion kapu jön majd,
                ha a BARION_POS_KEY beállításra kerül a backend-en. Mostani
                kattintás csak szimulálja az élményt.
              </Text>
            </View>

            <Pressable style={styles.payBtn} onPress={pay}>
              <Text style={styles.payBtnText}>💳 Fizetek most (STUB)</Text>
            </Pressable>
            <Pressable style={styles.cancelBtn} onPress={() => router.back()}>
              <Text style={styles.cancelBtnText}>Mégse</Text>
            </Pressable>
          </>
        )}

        {step === 'processing' && (
          <View style={styles.middleState}>
            <Text style={{ fontSize: 48, marginBottom: spacing.md }}>⏳</Text>
            <Text style={styles.middleTitle}>Fizetés feldolgozása…</Text>
            <Text style={styles.muted}>(kapcsolat a Barionnal szimulálva)</Text>
          </View>
        )}

        {step === 'done' && (
          <View style={styles.middleState}>
            <Text style={{ fontSize: 64, marginBottom: spacing.md }}>✅</Text>
            <Text style={styles.middleTitle}>Sikeres fizetés!</Text>
            <Text style={[styles.muted, { marginTop: spacing.sm }]}>
              {data.amount.toLocaleString('hu-HU')} Ft lefoglalva a Barion letétben
            </Text>
            <Text style={[styles.muted, { marginTop: spacing.md, fontSize: 12 }]}>
              Visszairányítás a foglalásaidhoz…
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: spacing.md, paddingTop: spacing.lg },
  muted: { color: colors.textMuted, fontSize: 13 },

  header: {
    backgroundColor: colors.primary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  headerSubtitle: { color: '#fff', opacity: 0.85, fontSize: 12 },

  card: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 0,
  },

  label: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  value: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 4 },
  row: { color: colors.text, fontSize: 14, marginTop: 2 },

  amountBox: {
    backgroundColor: '#f1f5f9',
    padding: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  amountLabel: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  amountValue: {
    color: colors.primary,
    fontSize: 32,
    fontWeight: '800',
    marginTop: 4,
  },

  warningBox: {
    backgroundColor: '#fef3c7',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  warningText: { color: '#92400e', fontSize: 12, lineHeight: 18 },

  payBtn: {
    backgroundColor: '#16a34a',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  payBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  cancelBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  cancelBtnText: { color: colors.textMuted, fontSize: 15 },

  middleState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  middleTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
});
