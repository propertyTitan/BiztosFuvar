// Sofőr: saját meghirdetett útvonalak listája.
import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

const STATUS_LABEL: Record<string, string> = {
  draft: 'Piszkozat',
  open: 'Publikálva',
  full: 'Betelt',
  in_progress: 'Úton',
  completed: 'Teljesítve',
  cancelled: 'Törölve',
};

const STATUS_COLOR: Record<string, string> = {
  draft: '#dbeafe',
  open: '#dcfce7',
  full: '#fef3c7',
  in_progress: '#e0e7ff',
  completed: '#dcfce7',
  cancelled: '#fee2e2',
};

export default function Utvonalaim() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myCarrierRoutes();
      setRoutes(data);
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
    <FlatList
      data={routes}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
      }
      ListHeaderComponent={
        <Link href="/uj-utvonal" asChild>
          <Pressable style={styles.newCta}>
            <Text style={styles.newCtaText}>+ Új útvonal hirdetése</Text>
          </Pressable>
        </Link>
      }
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            Még nincs meghirdetett útvonalad. Érintsd meg fent az „Új útvonal hirdetése" gombot.
          </Text>
        ) : null
      }
      renderItem={({ item }) => {
        const first = item.waypoints[0]?.name || '?';
        const last = item.waypoints[item.waypoints.length - 1]?.name || '?';
        const stops = item.waypoints.length > 2 ? ` (+${item.waypoints.length - 2} megálló)` : '';
        return (
          <Link href={{ pathname: '/utvonal/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                <View
                  style={[styles.pill, { backgroundColor: STATUS_COLOR[item.status] || colors.border }]}
                >
                  <Text style={styles.pillText}>{STATUS_LABEL[item.status]}</Text>
                </View>
              </View>
              <Text style={styles.row} numberOfLines={1}>
                📍 {first} → {last}{stops}
              </Text>
              <Text style={styles.row}>
                🗓 {new Date(item.departure_at).toLocaleString('hu-HU')}
              </Text>
              <View style={styles.priceRow}>
                {item.prices.map((p: any) => (
                  <View key={p.size} style={styles.priceChip}>
                    <Text style={styles.priceChipText}>
                      <Text style={{ fontWeight: '800' }}>{p.size}</Text> {p.price_huf.toLocaleString('hu-HU')} Ft
                    </Text>
                  </View>
                ))}
              </View>
            </Pressable>
          </Link>
        );
      }}
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
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.text },
  row: { color: colors.textMuted, marginBottom: 2, fontSize: 13 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  priceChip: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priceChipText: { fontSize: 12, color: colors.text },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
});
