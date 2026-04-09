// Feladó: sofőri útvonalak böngészése mobilon.
// - Város alapú szűrés (egyszerű szöveges input)
// - Kártyák → részletek + foglalás
import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl, TextInput, Alert,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

export default function UtvonalBongeszo() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [city, setCity] = useState('');

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

  return (
    <FlatList
      data={routes}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => load(city)} tintColor={colors.primary} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Útba eső sofőrök</Text>
          <Text style={styles.muted}>
            Sofőrök által meghirdetett útvonalak. Foglalj helyet a csomagod számára fix áron.
          </Text>
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
      }
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
        return (
          <Link href={{ pathname: '/feladas/utvonal/[id]', params: { id: item.id } }} asChild>
            <Pressable style={styles.card}>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
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
          </Link>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: spacing.xs },
  muted: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.md },
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
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
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
