// Fuvaraim — amiket TE teljesítesz sofőrként (licites elfogadott fuvarok).
// Ez a régi "sofőr saját fuvarai" screen, egységesítve minden user számára.
import { useCallback, useState } from 'react';
import {
  Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert, View,
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
  accepted: '#fef3c7',
  in_progress: '#e0e7ff',
  delivered: '#dcfce7',
  completed: '#dcfce7',
  cancelled: '#fee2e2',
};

export default function SajatFuvaraim() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myJobs('assigned');
      setJobs(data);
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
      data={jobs}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            Még nincs olyan fuvarod, amit Te teljesítesz sofőrként.{'\n'}
            Licitálj a „Licitálható fuvarok" menüből!
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <Link href={{ pathname: '/fuvar/[id]', params: { id: item.id } }} asChild>
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
            <Text style={[styles.row, styles.price]}>
              {(item.accepted_price_huf || item.suggested_price_huf || 0)
                .toLocaleString('hu-HU')} Ft
            </Text>
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl, lineHeight: 22 },
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
  price: { color: colors.primary, fontWeight: '700', fontSize: 15, marginTop: 4 },
});
