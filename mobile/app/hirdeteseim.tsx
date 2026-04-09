// Saját hirdetéseim — EGYESÍTETT lista mobilon:
//   - Licites fuvarok, amiket én adtam fel (myJobs('posted'))
//   - Fix áras útvonalak, amiket én hirdettem (myCarrierRoutes())
import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  bidding: 'Licitálható',
  accepted: 'Elfogadva',
  in_progress: 'Folyamatban',
  delivered: 'Lerakva',
  completed: 'Lezárva',
  disputed: 'Vitatott',
  cancelled: 'Lemondva',
};

const ROUTE_STATUS_LABEL: Record<string, string> = {
  draft: 'Piszkozat',
  open: 'Publikálva',
  full: 'Betelt',
  in_progress: 'Úton',
  completed: 'Teljesítve',
  cancelled: 'Törölve',
};

export default function Hirdeteseim() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [j, r] = await Promise.all([api.myJobs('posted'), api.myCarrierRoutes()]);
      setJobs(j);
      setRoutes(r);
    } catch (err: any) {
      Alert.alert('Hiba', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ScrollView
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
    >
      {/* Akció gombok */}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
        <Link href="/feladas/uj" asChild>
          <Pressable style={[styles.cta, { flex: 1 }]}>
            <Text style={styles.ctaText}>+ Új licites</Text>
          </Pressable>
        </Link>
        <Link href="/uj-utvonal" asChild>
          <Pressable style={[styles.cta, styles.ctaSecondary, { flex: 1 }]}>
            <Text style={[styles.ctaText, { color: colors.primary }]}>+ Új fix áras</Text>
          </Pressable>
        </Link>
      </View>

      {/* Licites fuvarok */}
      <Text style={styles.section}>📝 Licites fuvarjaim ({jobs.length})</Text>
      {jobs.length === 0 && (
        <Text style={styles.muted}>Nincs feladott licites fuvarod.</Text>
      )}
      {jobs.map((j) => (
        <Link
          key={j.id}
          href={{ pathname: '/feladas/[id]', params: { id: j.id } }}
          asChild
        >
          <Pressable style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.title} numberOfLines={1}>{j.title}</Text>
              <View style={[styles.pill, { backgroundColor: '#dbeafe' }]}>
                <Text style={styles.pillText}>{JOB_STATUS_LABEL[j.status] || j.status}</Text>
              </View>
            </View>
            <Text style={styles.row} numberOfLines={1}>📍 {j.pickup_address}</Text>
            <Text style={styles.row} numberOfLines={1}>🏁 {j.dropoff_address}</Text>
            <Text style={styles.price}>
              {(j.accepted_price_huf || j.suggested_price_huf || 0).toLocaleString('hu-HU')} Ft
            </Text>
          </Pressable>
        </Link>
      ))}

      {/* Fix áras útvonalak */}
      <Text style={[styles.section, { marginTop: spacing.lg }]}>
        🛣️ Fix áras útvonalaim ({routes.length})
      </Text>
      {routes.length === 0 && (
        <Text style={styles.muted}>Nincs meghirdetett útvonalad.</Text>
      )}
      {routes.map((r) => {
        const first = r.waypoints?.[0]?.name || '?';
        const last = r.waypoints?.[r.waypoints.length - 1]?.name || '?';
        return (
          <Link
            key={r.id}
            href={{ pathname: '/utvonal/[id]', params: { id: r.id } }}
            asChild
          >
            <Pressable style={styles.card}>
              <View style={styles.head}>
                <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
                <View style={[styles.pill, { backgroundColor: '#dcfce7' }]}>
                  <Text style={styles.pillText}>
                    {ROUTE_STATUS_LABEL[r.status] || r.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.row} numberOfLines={1}>
                📍 {first} → {last}
              </Text>
              <Text style={styles.row}>
                🗓 {new Date(r.departure_at).toLocaleString('hu-HU')}
              </Text>
              <View style={styles.priceRow}>
                {(r.prices || []).map((p: any) => (
                  <View key={p.size} style={styles.priceChip}>
                    <Text style={styles.priceChipText}>
                      <Text style={{ fontWeight: '800' }}>{p.size}</Text>{' '}
                      {p.price_huf.toLocaleString('hu-HU')} Ft
                    </Text>
                  </View>
                ))}
              </View>
            </Pressable>
          </Link>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  muted: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.text },
  row: { color: colors.textMuted, fontSize: 13, marginBottom: 2 },
  price: { color: colors.primary, fontWeight: '700', fontSize: 15, marginTop: 4 },

  priceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  priceChip: { backgroundColor: '#eff6ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  priceChipText: { fontSize: 12, color: colors.text },

  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  ctaSecondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
