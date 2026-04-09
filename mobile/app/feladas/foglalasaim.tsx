// Feladói foglalásaim képernyő mobilon – route_bookings lista.
// Ez az, ahol Péter látja, hogy János elfogadta-e a fix áras foglalást.
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl, Linking,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import { colors, spacing, radius } from '@/theme';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Sofőri megerősítésre vár',
  confirmed: 'Elfogadva',
  rejected: 'Elutasítva',
  in_progress: 'Úton',
  delivered: 'Átadva',
  cancelled: 'Törölve',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#fef3c7',
  confirmed: '#dcfce7',
  rejected: '#fee2e2',
  in_progress: '#e0e7ff',
  delivered: '#dcfce7',
  cancelled: '#fee2e2',
};

export default function Foglalasaim() {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.myRouteBookings();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Real-time: ha értesítés érkezik foglalásra, újratöltünk
  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      if (!u) return;
      joinUserRoom(u.id);
      const socket = getSocket();
      const onNotif = (n: any) => {
        if (
          n.type === 'booking_confirmed' ||
          n.type === 'booking_rejected' ||
          n.type === 'booking_received'
        ) {
          load();
        }
      };
      socket.on('notification:new', onNotif);
      return () => socket.off('notification:new', onNotif);
    })();
  }, [load]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      ListEmptyComponent={
        !loading ? (
          <Text style={styles.empty}>
            Még nincs foglalásod.{'\n'}
            Nézd meg az „Útba eső sofőrök" menüt.
          </Text>
        ) : null
      }
      renderItem={({ item: b }) => (
        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={1}>
              {b.route_title || 'Sofőri útvonal'}
            </Text>
            <View style={[styles.pill, { backgroundColor: STATUS_COLOR[b.status] || colors.border }]}>
              <Text style={styles.pillText}>{STATUS_LABEL[b.status]}</Text>
            </View>
          </View>
          {b.carrier_name && <Text style={styles.row}>🚛 {b.carrier_name}</Text>}
          {b.departure_at && (
            <Text style={styles.row}>🗓 {new Date(b.departure_at).toLocaleString('hu-HU')}</Text>
          )}
          <Text style={styles.row} numberOfLines={1}>📍 {b.pickup_address}</Text>
          <Text style={styles.row} numberOfLines={1}>🏁 {b.dropoff_address}</Text>
          <Text style={styles.rowMuted}>
            {b.package_size} · {b.length_cm}×{b.width_cm}×{b.height_cm} cm · {b.weight_kg} kg
          </Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{b.price_huf.toLocaleString('hu-HU')} Ft</Text>
          </View>

          {/* Átvételi kód csak confirmed/in_progress állapotban */}
          {b.delivery_code && ['confirmed', 'in_progress'].includes(b.status) && (
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>🔐 ÁTVÉTELI KÓD</Text>
              <Text style={styles.codeValue}>{b.delivery_code}</Text>
              <Text style={styles.codeHint}>
                Add át a sofőrnek az átadáskor — ezzel zárja le a fuvart.
              </Text>
            </View>
          )}

          {/* Fizetés gomb – amint a sofőr megerősítette, a Barion gateway elérhető */}
          {b.status === 'confirmed' && b.barion_gateway_url && (
            <Pressable
              style={styles.payBtn}
              onPress={() => Linking.openURL(b.barion_gateway_url)}
            >
              <Text style={styles.payBtnText}>💳 Fizetés Barionnal</Text>
            </Pressable>
          )}
          {b.status === 'confirmed' && !b.barion_gateway_url && (
            <Text style={styles.stubNote}>
              Barion STUB mód – valódi gateway nincs
            </Text>
          )}
        </View>
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
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  pillText: { fontSize: 11, fontWeight: '700', color: colors.text },
  row: { color: colors.text, fontSize: 14, marginBottom: 2 },
  rowMuted: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  priceRow: { marginTop: 6 },
  price: { color: colors.primary, fontWeight: '700', fontSize: 18 },

  codeBox: {
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  codeLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    opacity: 0.85,
    marginBottom: spacing.xs,
  },
  codeValue: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
    fontFamily: 'Courier',
  },
  codeHint: { color: '#fff', fontSize: 12, opacity: 0.9, marginTop: 6, textAlign: 'center' },

  payBtn: {
    backgroundColor: '#16a34a',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  payBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  stubNote: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
});
