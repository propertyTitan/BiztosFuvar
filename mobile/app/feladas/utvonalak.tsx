// Feladó: sofőri útvonalak böngészése mobilon.
// - Város alapú szűrés (egyszerű szöveges input)
// - Lista / térkép toggle
// - A saját útvonalak is megjelennek, de "Saját poszt" címkével és
//   koppintásra a sofőri részletek oldalra visszük (ott van szerkesztés),
//   nem a foglalás űrlapra.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl, TextInput, Alert, Platform,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, Callout, PROVIDER_GOOGLE } from 'react-native-maps';
import { api } from '@/api';
import { getCurrentUser, CurrentUser } from '@/auth';
import { colors, spacing, radius } from '@/theme';

type ViewMode = 'list' | 'map';
const HUNGARY_REGION = {
  latitude: 47.1625,
  longitude: 19.5033,
  latitudeDelta: 4.0,
  longitudeDelta: 4.0,
};

export default function UtvonalBongeszo() {
  const router = useRouter();
  const mapRef = useRef<MapView | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [city, setCity] = useState('');
  const [view, setView] = useState<ViewMode>('list');

  useEffect(() => {
    getCurrentUser().then(setMe);
  }, []);

  const load = useCallback(async (filterCity?: string) => {
    setLoading(true);
    try {
      const data = await api.listCarrierRoutes(filterCity || undefined);
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

  // Térkép auto-fit: minden waypoint-ra ráközelít
  useEffect(() => {
    if (view !== 'map' || routes.length === 0 || !mapRef.current) return;
    const t = setTimeout(() => {
      const coords = routes.flatMap((r: any) =>
        (r.waypoints || []).map((w: any) => ({ latitude: w.lat, longitude: w.lng })),
      );
      if (coords.length > 0) {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 60, bottom: 80, left: 60 },
          animated: true,
        });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [view, routes]);

  function goToRoute(item: any) {
    const isMine = !!me && item.carrier_id === me.id;
    if (isMine) {
      router.push({ pathname: '/utvonal/[id]', params: { id: item.id } });
    } else {
      router.push({ pathname: '/feladas/utvonal/[id]', params: { id: item.id } });
    }
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Útba eső sofőrök</Text>
      <Text style={styles.muted}>
        Sofőrök által meghirdetett útvonalak. Foglalj helyet a csomagod számára fix áron.
      </Text>
      {/* Toggle sáv */}
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
      <View style={styles.searchRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={city}
          onChangeText={setCity}
          placeholder="Szűrés város szerint"
          autoCapitalize="none"
        />
        <Pressable style={styles.searchBtn} onPress={() => load(city)}>
          <Text style={styles.searchBtnText}>Keresés</Text>
        </Pressable>
      </View>
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
          {routes.map((r: any) => {
            const isMine = !!me && r.carrier_id === me.id;
            const waypoints = r.waypoints || [];
            if (waypoints.length < 2) return null;
            const first = waypoints[0];
            const last = waypoints[waypoints.length - 1];
            const coords = waypoints.map((w: any) => ({ latitude: w.lat, longitude: w.lng }));
            return (
              <Fragment key={r.id}>
                <Polyline
                  coordinates={coords}
                  strokeColor={isMine ? 'rgba(250, 204, 21, 0.55)' : 'rgba(30, 64, 175, 0.5)'}
                  strokeWidth={3}
                  lineDashPattern={[6, 6]}
                />
                <Marker
                  coordinate={{ latitude: first.lat, longitude: first.lng }}
                  pinColor={isMine ? 'yellow' : 'green'}
                  onCalloutPress={() => goToRoute(r)}
                >
                  <Callout tooltip={false}>
                    <View style={{ padding: 6, minWidth: 200 }}>
                      <Text style={{ fontWeight: '800', fontSize: 14 }}>
                        {r.title}
                        {isMine ? ' (saját)' : ''}
                      </Text>
                      <Text style={{ color: '#475569', fontSize: 11, marginTop: 2 }}>
                        📍 {waypoints.map((w: any) => w.name).join(' → ')}
                      </Text>
                      <Text style={{ color: '#475569', fontSize: 11 }}>
                        🗓 {new Date(r.departure_at).toLocaleString('hu-HU')}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                        {(r.prices || []).map((p: any) => (
                          <View
                            key={p.size}
                            style={{
                              backgroundColor: '#eff6ff',
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 999,
                            }}
                          >
                            <Text style={{ fontSize: 10 }}>
                              <Text style={{ fontWeight: '800' }}>{p.size}</Text> {p.price_huf.toLocaleString('hu-HU')} Ft
                            </Text>
                          </View>
                        ))}
                      </View>
                      <Text style={{ color: '#2563eb', fontSize: 11, marginTop: 4 }}>
                        Koppints a részletekhez →
                      </Text>
                    </View>
                  </Callout>
                </Marker>
                <Marker
                  coordinate={{ latitude: last.lat, longitude: last.lng }}
                  pinColor="red"
                  onCalloutPress={() => goToRoute(r)}
                >
                  <Callout tooltip={false}>
                    <View style={{ padding: 6, minWidth: 160 }}>
                      <Text style={{ fontWeight: '700', fontSize: 13 }}>{r.title} – cél</Text>
                      <Text style={{ color: '#475569', fontSize: 11 }}>{last.name}</Text>
                    </View>
                  </Callout>
                </Marker>
              </Fragment>
            );
          })}
        </MapView>
        <View style={styles.mapLegend}>
          <Text style={styles.mapLegendText}>
            🟢 Indulás · 🔴 Cél · 🟡 Saját poszt
          </Text>
        </View>
      </View>
    );
  }

  return (
    <FlatList
      data={routes}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => load(city)} tintColor={colors.primary} />
      }
      ListHeaderComponent={header}
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            Nincs nyitott útvonal{city ? ` „${city}" városra` : ''}.
          </Text>
        ) : null
      }
      renderItem={({ item }) => {
        const first = item.waypoints[0]?.name || '?';
        const last = item.waypoints[item.waypoints.length - 1]?.name || '?';
        const stops = item.waypoints.length > 2 ? ` (+${item.waypoints.length - 2} megálló)` : '';
        const isMine = !!me && item.carrier_id === me.id;
        return (
          <Pressable style={[styles.card, isMine && styles.mineCard]} onPress={() => goToRoute(item)}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
              {isMine && (
                <View style={styles.mineBadge}>
                  <Text style={styles.mineBadgeText}>SAJÁT POSZT</Text>
                </View>
              )}
            </View>
            <Text style={styles.row} numberOfLines={1}>
              📍 {first} → {last}{stops}
            </Text>
            <Text style={styles.row}>
              🗓 {new Date(item.departure_at).toLocaleString('hu-HU')}
            </Text>
            {item.vehicle_description ? (
              <Text style={styles.row}>🚛 {item.vehicle_description}</Text>
            ) : null}
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
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  muted: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md },

  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
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

  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
    color: colors.text,
  },
  searchBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  searchBtnText: { color: '#fff', fontWeight: '700' },

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
    marginBottom: spacing.xs,
  },
  mineBadge: {
    backgroundColor: '#facc15',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  mineBadgeText: { color: '#713f12', fontWeight: '800', fontSize: 10, letterSpacing: 0.3 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  row: { color: colors.textMuted, marginBottom: 2, fontSize: 13 },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  priceChip: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  priceChipText: { fontSize: 12, color: colors.text },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
});
