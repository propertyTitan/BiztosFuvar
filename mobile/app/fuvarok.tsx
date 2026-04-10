// Sofőr nézet: elérhető fuvarok listája + térképes böngésző.
// A saját feladásokat "Saját poszt" címkével jelöljük, és koppintáskor
// a feladói részletek oldalra visszük — ne lehessen rájuk licitálni.
// Lista / térkép toggle a fejlécben.
import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Alert, Platform, TextInput } from 'react-native';
import { Link, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, Callout, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from '@/api';
import { getCurrentUser, CurrentUser } from '@/auth';
import { colors, spacing, radius } from '@/theme';

type Job = {
  id: string;
  shipper_id: string;
  title: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  distance_km: number;
  distance_to_pickup_km?: number;
  suggested_price_huf: number;
};

type ViewMode = 'list' | 'map';
const HUNGARY_REGION = {
  latitude: 47.1625,
  longitude: 19.5033,
  latitudeDelta: 4.0,
  longitudeDelta: 4.0,
};

export default function Fuvarok() {
  const router = useRouter();
  const mapRef = useRef<MapView | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<ViewMode>('list');
  // Szűrők
  const [filterMinPrice, setFilterMinPrice] = useState('');
  const [filterMaxPrice, setFilterMaxPrice] = useState('');
  const [filterMaxWeight, setFilterMaxWeight] = useState('');
  const [showFilters, setShowFilters] = useState(false);

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
      const data = await api.nearbyJobs(lat, lng, 500, {
        min_price: filterMinPrice ? Number(filterMinPrice) : undefined,
        max_price: filterMaxPrice ? Number(filterMaxPrice) : undefined,
        max_weight_kg: filterMaxWeight ? Number(filterMaxWeight) : undefined,
      });
      setJobs(data);
    } catch (err: any) {
      Alert.alert('Hiba', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Ha térkép módba váltunk és vannak fuvarok, auto-fit ráközelít
  // minden felvételi + lerakodási pontra, hogy ne csak Magyarországot
  // lássa a user nagyban.
  useEffect(() => {
    if (view !== 'map' || jobs.length === 0 || !mapRef.current) return;
    // Kis delay, hogy a térkép biztosan ki legyen renderelve
    const t = setTimeout(() => {
      const coords = jobs.flatMap((j) => [
        { latitude: j.pickup_lat, longitude: j.pickup_lng },
        { latitude: j.dropoff_lat, longitude: j.dropoff_lng },
      ]);
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
        animated: true,
      });
    }, 300);
    return () => clearTimeout(t);
  }, [view, jobs]);

  function goToJob(item: Job) {
    const isMine = !!me && item.shipper_id === me.id;
    if (isMine) {
      router.push({ pathname: '/feladas/[id]', params: { id: item.id } });
    } else {
      router.push({ pathname: '/fuvar/[id]', params: { id: item.id } });
    }
  }

  const header = (
    <View style={{ gap: 8, marginBottom: spacing.md }}>
      {/* Toggle sáv: lista ↔ térkép */}
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleBtn, view === 'list' && styles.toggleBtnActive]}
          onPress={() => setView('list')}
        >
          <Text style={[styles.toggleBtnText, view === 'list' && styles.toggleBtnTextActive]}>
            📋 Lista
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, view === 'map' && styles.toggleBtnActive]}
          onPress={() => setView('map')}
        >
          <Text style={[styles.toggleBtnText, view === 'map' && styles.toggleBtnTextActive]}>
            🗺️ Térkép
          </Text>
        </Pressable>
      </View>
      {/* Szűrők */}
      <Pressable onPress={() => setShowFilters((s) => !s)} style={{ alignSelf: 'center', marginBottom: spacing.sm }}>
        <Text style={{ color: colors.primary, fontWeight: '600', fontSize: 13 }}>
          🔍 {showFilters ? 'Szűrők elrejtése' : 'Szűrők mutatása'}
        </Text>
      </Pressable>
      {showFilters && (
        <View style={styles.filterCard}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.filterLabel}>Min ár (Ft)</Text>
              <TextInput
                style={styles.filterInput}
                keyboardType="number-pad"
                value={filterMinPrice}
                onChangeText={setFilterMinPrice}
                placeholder="10000"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.filterLabel}>Max ár (Ft)</Text>
              <TextInput
                style={styles.filterInput}
                keyboardType="number-pad"
                value={filterMaxPrice}
                onChangeText={setFilterMaxPrice}
                placeholder="100000"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.filterLabel}>Max súly (kg)</Text>
              <TextInput
                style={styles.filterInput}
                keyboardType="number-pad"
                value={filterMaxWeight}
                onChangeText={setFilterMaxWeight}
                placeholder="50"
              />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <Pressable style={styles.filterBtn} onPress={load}>
              <Text style={styles.filterBtnText}>Szűrés</Text>
            </Pressable>
            {(filterMinPrice || filterMaxPrice || filterMaxWeight) && (
              <Pressable
                style={[styles.filterBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
                onPress={() => {
                  setFilterMinPrice('');
                  setFilterMaxPrice('');
                  setFilterMaxWeight('');
                  setTimeout(load, 50);
                }}
              >
                <Text style={[styles.filterBtnText, { color: colors.textMuted }]}>Törlés</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

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
  );

  if (view === 'map') {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ padding: spacing.md, paddingBottom: 0 }}>{header}</View>
        <MapView
          ref={(r) => { mapRef.current = r; }}
          style={{ flex: 1 }}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={HUNGARY_REGION}
        >
          {jobs.map((j) => {
            const isMine = !!me && j.shipper_id === me.id;
            return (
              <Fragment key={j.id}>
                <Polyline
                  coordinates={[
                    { latitude: j.pickup_lat, longitude: j.pickup_lng },
                    { latitude: j.dropoff_lat, longitude: j.dropoff_lng },
                  ]}
                  strokeColor={isMine ? 'rgba(250, 204, 21, 0.5)' : 'rgba(30, 64, 175, 0.45)'}
                  strokeWidth={2}
                  lineDashPattern={[6, 6]}
                />
                <Marker
                  coordinate={{ latitude: j.pickup_lat, longitude: j.pickup_lng }}
                  pinColor={isMine ? 'yellow' : 'green'}
                  onCalloutPress={() => goToJob(j)}
                >
                  <Callout tooltip={false}>
                    <View style={{ padding: 6, minWidth: 180 }}>
                      <Text style={{ fontWeight: '800', fontSize: 14 }}>
                        {j.title}
                        {isMine ? ' (saját)' : ''}
                      </Text>
                      <Text style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                        📍 {j.pickup_address}
                      </Text>
                      <Text style={{ color: '#475569', fontSize: 11 }}>
                        🏁 {j.dropoff_address}
                      </Text>
                      <Text
                        style={{
                          color: '#1e40af',
                          fontWeight: '800',
                          fontSize: 14,
                          marginTop: 4,
                        }}
                      >
                        {j.suggested_price_huf?.toLocaleString('hu-HU')} Ft
                      </Text>
                      <Text style={{ color: '#2563eb', fontSize: 11, marginTop: 4 }}>
                        Koppints a részletekhez →
                      </Text>
                    </View>
                  </Callout>
                </Marker>
                <Marker
                  coordinate={{ latitude: j.dropoff_lat, longitude: j.dropoff_lng }}
                  pinColor="red"
                  onCalloutPress={() => goToJob(j)}
                >
                  <Callout tooltip={false}>
                    <View style={{ padding: 6, minWidth: 160 }}>
                      <Text style={{ fontWeight: '700', fontSize: 13 }}>{j.title} – cél</Text>
                      <Text style={{ color: '#475569', fontSize: 11 }}>{j.dropoff_address}</Text>
                    </View>
                  </Callout>
                </Marker>
              </Fragment>
            );
          })}
        </MapView>
        <View style={styles.mapLegend}>
          <Text style={styles.mapLegendText}>
            🟢 Felvétel · 🔴 Lerakodás · 🟡 Saját poszt
          </Text>
        </View>
      </View>
    );
  }

  return (
    <FlatList
      data={jobs}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <Text style={styles.empty}>Jelenleg nincs elérhető fuvar a környéken.</Text>
      }
      renderItem={({ item }) => {
        const isMine = !!me && item.shipper_id === me.id;
        return (
          <Pressable style={[styles.card, isMine && styles.mineCard]} onPress={() => goToJob(item)}>
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
  },
  myBidsBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },

  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 999,
  },
  toggleBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleBtnText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  toggleBtnTextActive: { color: colors.text, fontWeight: '700' },

  mapLegend: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  mapLegendText: { fontSize: 12, color: colors.textMuted },

  filterCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  filterLabel: { fontSize: 11, color: colors.textMuted, marginBottom: 2 },
  filterInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  filterBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  filterBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
