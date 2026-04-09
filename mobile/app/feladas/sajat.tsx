// Feladó saját fuvarai listája mobilon.
// - Pull-to-refresh
// - Új fuvar gomb felül
// - Egy fuvar koppintásra → /feladas/[id] részletek oldal
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  bidding: 'Licitálható',
  accepted: 'Elfogadva',
  in_progress: 'Folyamatban',
  delivered: 'Lerakva',
  completed: 'Lezárva',
  disputed: 'Vitatott',
  cancelled: 'Lemondva',
};

const STATUS_COLOR: Record<string, string> = {
  bidding: '#dbeafe',
  accepted: '#fef3c7',
  in_progress: '#e0e7ff',
  delivered: '#dcfce7',
  completed: '#dcfce7',
  cancelled: '#fee2e2',
};

export default function FeladasSajat() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myJobs();
      setJobs(data);
    } catch (err: any) {
      Alert.alert('Hiba', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Az oldal minden fókuszáláskor újratölt (pl. visszajövés új fuvar feladásból)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <FlatList
      data={jobs}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
      }
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: spacing.md }}>
          <Link href="/feladas/uj" asChild>
            <Pressable style={styles.newCta}>
              <Text style={styles.newCtaText}>+ Új fuvar feladása (licit)</Text>
            </Pressable>
          </Link>
          <Link href="/feladas/utvonalak" asChild>
            <Pressable style={[styles.newCta, { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary }]}>
              <Text style={[styles.newCtaText, { color: colors.primary }]}>🛣 Útba eső sofőrök (fix ár)</Text>
            </Pressable>
          </Link>
        </View>
      }
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            Még nincs feladott fuvarod. Érintsd meg fent az „Új fuvar feladása" gombot.
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <Link href={{ pathname: '/feladas/[id]', params: { id: item.id } }} asChild>
          <Pressable style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <View
                style={[
                  styles.pill,
                  { backgroundColor: STATUS_COLOR[item.status] || colors.border },
                ]}
              >
                <Text style={styles.pillText}>{STATUS_LABEL[item.status] || item.status}</Text>
              </View>
            </View>
            <Text style={styles.row} numberOfLines={1}>📍 {item.pickup_address}</Text>
            <Text style={styles.row} numberOfLines={1}>🏁 {item.dropoff_address}</Text>
            <View style={styles.meta}>
              {item.distance_km != null && (
                <Text style={styles.metaItem}>{item.distance_km} km</Text>
              )}
              {item.weight_kg != null && (
                <Text style={styles.metaItem}>{item.weight_kg} kg</Text>
              )}
              <Text style={[styles.metaItem, styles.price]}>
                {(item.accepted_price_huf || item.suggested_price_huf || 0)
                  .toLocaleString('hu-HU')} Ft
              </Text>
            </View>
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  newCta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  newCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, flex: 1 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.text },
  row: { color: colors.textMuted, marginBottom: 2, fontSize: 14 },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  metaItem: { fontSize: 13, color: colors.textMuted },
  price: { color: colors.primary, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
});
