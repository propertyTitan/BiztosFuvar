// Sofőr "Licitjeim" képernyő mobilon.
// - Minden licit, amit a sofőr leadott, csoportosítva: elfogadott / várakozik / vesztes.
// - Koppintás a kártyára → fuvar részletek oldala.
import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { colors, spacing, radius } from '@/theme';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Várakozik',
  accepted: 'Elfogadva',
  rejected: 'Elutasítva',
  withdrawn: 'Visszavonva',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#dbeafe',
  accepted: '#dcfce7',
  rejected: '#fee2e2',
  withdrawn: '#fee2e2',
};

export default function Licitjeim() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [data, me] = await Promise.all([api.myBids(), getCurrentUser()]);
      setRows(data);
      setMyId(me?.id ?? null);
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

  // A csoportosítás érthető fejlécekkel
  const sections = [
    { title: '✅ Elfogadva', items: rows.filter((r) => r.bid_status === 'accepted') },
    { title: '⏳ Várakozik', items: rows.filter((r) => r.bid_status === 'pending') },
    {
      title: '✗ Nem nyert',
      items: rows.filter(
        (r) => r.bid_status === 'rejected' || r.bid_status === 'withdrawn',
      ),
    },
  ].filter((s) => s.items.length > 0);

  return (
    <FlatList
      data={sections}
      keyExtractor={(s) => s.title}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            Még nem adtál le licitet. Nézelődj az „Elérhető fuvarok" között!
          </Text>
        ) : null
      }
      renderItem={({ item: section }) => (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={styles.sectionTitle}>
            {section.title} ({section.items.length})
          </Text>
          {section.items.map((r) => {
            const iAmCarrier = r.job_carrier_id === myId;
            return (
              <Link
                key={r.bid_id}
                href={{ pathname: '/fuvar/[id]', params: { id: r.job_id } }}
                asChild
              >
                <Pressable style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.title} numberOfLines={1}>
                      {r.job_title}
                    </Text>
                    <View
                      style={[
                        styles.pill,
                        { backgroundColor: STATUS_COLOR[r.bid_status] || colors.border },
                      ]}
                    >
                      <Text style={styles.pillText}>
                        {STATUS_LABEL[r.bid_status] || r.bid_status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.row} numberOfLines={1}>
                    📍 {r.pickup_address}
                  </Text>
                  <Text style={styles.row} numberOfLines={1}>
                    🏁 {r.dropoff_address}
                  </Text>
                  <View style={styles.meta}>
                    <Text style={styles.price}>
                      {r.amount_huf.toLocaleString('hu-HU')} Ft
                    </Text>
                    {r.eta_minutes && (
                      <Text style={styles.metaItem}>~{r.eta_minutes} perc</Text>
                    )}
                    {r.distance_km != null && (
                      <Text style={styles.metaItem}>{r.distance_km} km</Text>
                    )}
                  </View>
                  {r.message ? (
                    <Text style={styles.message} numberOfLines={2}>
                      „{r.message}"
                    </Text>
                  ) : null}
                  {iAmCarrier && (
                    <Text style={styles.winner}>🎉 Tiéd a fuvar</Text>
                  )}
                </Pressable>
              </Link>
            );
          })}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
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
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.text },
  row: { color: colors.textMuted, marginBottom: 2, fontSize: 13 },
  meta: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  price: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  metaItem: { fontSize: 12, color: colors.textMuted },
  message: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
    fontSize: 13,
  },
  winner: {
    marginTop: spacing.sm,
    color: colors.success,
    fontWeight: '700',
    fontSize: 13,
  },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
});
