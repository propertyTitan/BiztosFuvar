// Sofőr nézet: elérhető fuvarok listája távolság szerint.
// A saját feladásokat "Saját poszt" címkével jelöljük, és koppintáskor
// a feladói részletek oldalra visszük — ne lehessen rájuk licitálni.
import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert } from 'react-native';
import { Link, useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { api } from '@/api';
import { getCurrentUser, CurrentUser } from '@/auth';
import { colors, spacing, radius } from '@/theme';

type Job = {
  id: string;
  shipper_id: string;
  title: string;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number;
  distance_to_pickup_km?: number;
  suggested_price_huf: number;
};

export default function Fuvarok() {
  const router = useRouter();
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getCurrentUser().then(setMe);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let lat = 47.4979, lng = 19.054; // alapból Budapest
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({});
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }
      const data = await api.nearbyJobs(lat, lng, 500);
      setJobs(data);
    } catch (err: any) {
      Alert.alert('Hiba', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <FlatList
      data={jobs}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: spacing.md }}>
          <Link href="/licitjeim" asChild>
            <Pressable style={styles.myBidsBtn}>
              <Text style={styles.myBidsBtnText}>📋 Licitjeim megtekintése</Text>
            </Pressable>
          </Link>
          <Link href="/utvonalaim" asChild>
            <Pressable style={styles.myBidsBtn}>
              <Text style={styles.myBidsBtnText}>🛣 Útvonalaim (saját hirdetések)</Text>
            </Pressable>
          </Link>
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>Jelenleg nincs elérhető fuvar a környéken.</Text>
      }
      renderItem={({ item }) => {
        const isMine = !!me && item.shipper_id === me.id;
        // Saját poszt → feladói részletek (licites lista + szerkesztés),
        // nem a sofőri nézet, ahol licit űrlap van.
        const onPress = () => {
          if (isMine) {
            router.push({ pathname: '/feladas/[id]', params: { id: item.id } });
          } else {
            router.push({ pathname: '/fuvar/[id]', params: { id: item.id } });
          }
        };
        return (
          <Pressable style={[styles.card, isMine && styles.mineCard]} onPress={onPress}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              {isMine && (
                <View style={styles.mineBadge}>
                  <Text style={styles.mineBadgeText}>SAJÁT POSZT</Text>
                </View>
              )}
            </View>
            <Text style={styles.row}>📍 {item.pickup_address}</Text>
            <Text style={styles.row}>🏁 {item.dropoff_address}</Text>
            <View style={styles.meta}>
              <Text style={styles.metaItem}>{item.distance_km} km</Text>
              {item.distance_to_pickup_km != null && (
                <Text style={styles.metaItem}>📍 {item.distance_to_pickup_km} km tőled</Text>
              )}
              <Text style={[styles.metaItem, styles.price]}>
                {item.suggested_price_huf?.toLocaleString('hu-HU')} Ft
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mineCard: { backgroundColor: '#fefce8', borderColor: '#facc15' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  mineBadge: {
    backgroundColor: '#facc15',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  mineBadgeText: { color: '#713f12', fontWeight: '800', fontSize: 10, letterSpacing: 0.3 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, flex: 1 },
  row: { color: colors.textMuted, marginBottom: 2, fontSize: 14 },
  meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, gap: spacing.sm },
  metaItem: { fontSize: 13, color: colors.textMuted },
  price: { color: colors.primary, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  myBidsBtn: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  myBidsBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
