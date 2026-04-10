// Sofőr: egy konkrét útvonal részlete mobilon.
// A beérkezett foglalásokat látja, és elfogadni/elutasítani tud.
// A foglalásokon látszik a FIZETVE címke is, ha a feladó már fizetett
// (real-time `route-booking:paid` event frissíti azonnal).
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Alert, Linking,
} from 'react-native';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import { useToast } from '@/components/ToastProvider';
import TruckLoader from '@/components/TruckLoader';
import { colors, spacing, radius } from '@/theme';

const BOOKING_STATUS_LABEL: Record<string, string> = {
  pending: 'Válaszra vár',
  confirmed: 'Elfogadva',
  rejected: 'Elutasítva',
  in_progress: 'Úton',
  delivered: 'Lerakva',
  cancelled: 'Törölve',
  disputed: 'Vitatott',
};

export default function SoforUtvonalReszletek() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [route, setRoute] = useState<any>(null);
  const [bookings, setBookings] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const [r, b] = await Promise.all([
        api.getCarrierRoute(id!),
        api.listRouteBookings(id!),
      ]);
      setRoute(r);
      setBookings(b);
    } catch (err: any) {
      Alert.alert('Hiba', err.message);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Real-time: ha egy foglalást kifizet a feladó, azonnal frissítsük
  // a listát, hogy a sofőr lássa a FIZETVE címkét.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      const u = await getCurrentUser();
      if (!u) return;
      joinUserRoom(u.id);
      const socket = getSocket();
      const onPaid = () => load();
      socket.on('route-booking:paid', onPaid);
      cleanup = () => socket.off('route-booking:paid', onPaid);
    })();
    return () => cleanup?.();
  }, [load]);

  async function confirmBooking(bookingId: string) {
    try {
      await api.confirmRouteBooking(bookingId);
      toast.success('Foglalás elfogadva', 'A feladó most tudja kifizetni');
      await load();
    } catch (err: any) {
      toast.error('Hiba', err.message);
    }
  }

  function cancelBookingPress(b: any) {
    const wasPaid = !!b.paid_at;
    const message = wasPaid
      ? 'Biztosan lemondod ezt a már elfogadott foglalást? A teljes fuvardíj visszajár a feladónak.'
      : 'Biztosan lemondod ezt a foglalást?';
    Alert.alert('Lemondás', message, [
      { text: 'Mégse' },
      {
        text: 'Lemondom',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.cancelRouteBooking(b.id);
            toast.info('Foglalás lemondva', 'A feladó visszakapja a teljes díjat.');
            await load();
          } catch (e: any) {
            toast.error('Lemondás sikertelen', e.message);
          }
        },
      },
    ]);
  }

  async function rejectBooking(bookingId: string) {
    Alert.alert('Elutasítás', 'Biztosan elutasítod ezt a foglalást?', [
      { text: 'Mégse' },
      {
        text: 'Elutasítom',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.rejectRouteBooking(bookingId);
            toast.info('Foglalás elutasítva');
            await load();
          } catch (err: any) {
            toast.error('Hiba', err.message);
          }
        },
      },
    ]);
  }

  if (!route) return <TruckLoader />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{route.title}</Text>
      <Text style={styles.muted}>
        🗓 {new Date(route.departure_at).toLocaleString('hu-HU')}
      </Text>

      {/* Szerkesztés + státusz váltás — csak a sofőré */}
      {(route.status === 'draft' || route.status === 'open') && (
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
          <Link href={{ pathname: '/uj-utvonal', params: { edit: route.id } }} asChild>
            <Pressable style={styles.editBtn}>
              <Text style={styles.editBtnText}>✏️ Szerkesztés</Text>
            </Pressable>
          </Link>
          {route.status === 'draft' && (
            <Pressable
              style={styles.publishBtn}
              onPress={async () => {
                try {
                  await api.setCarrierRouteStatus(route.id, 'open');
                  await load();
                } catch (err: any) {
                  Alert.alert('Hiba', err.message);
                }
              }}
            >
              <Text style={styles.publishBtnText}>🚀 Publikálás</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Waypoints */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Útvonal</Text>
        <View style={styles.tagRow}>
          {route.waypoints.map((w: any, i: number) => (
            <View
              key={i}
              style={[
                styles.tag,
                i === 0 && { backgroundColor: '#dcfce7' },
                i === route.waypoints.length - 1 && { backgroundColor: '#fee2e2' },
              ]}
            >
              <Text style={styles.tagText}>
                <Text style={styles.tagIndex}>
                  {i === 0 ? 'INDULÁS · ' : i === route.waypoints.length - 1 ? 'CÉL · ' : `${i}. · `}
                </Text>
                {w.name}
              </Text>
            </View>
          ))}
        </View>
        {route.vehicle_description && (
          <Text style={[styles.row, { marginTop: 8 }]}>🚛 {route.vehicle_description}</Text>
        )}
        {route.description ? (
          <Text style={styles.description}>{route.description}</Text>
        ) : null}
      </View>

      {/* Árak */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Árak</Text>
        <View style={styles.priceRow}>
          {route.prices.map((p: any) => (
            <View key={p.size} style={styles.priceChip}>
              <Text style={styles.priceChipSize}>{p.size}</Text>
              <Text style={styles.priceChipAmount}>{p.price_huf.toLocaleString('hu-HU')} Ft</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Foglalások */}
      <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>
        Foglalások ({bookings.length})
      </Text>

      {bookings.length === 0 && (
        <Text style={styles.muted}>Még nincs foglalás erre az útvonalra.</Text>
      )}

      {bookings.map((b) => (
        <View key={b.id} style={styles.bookingCard}>
          <View style={styles.bookingHead}>
            <Text style={styles.bookingShipper}>{b.shipper_name || 'Feladó'}</Text>
            <Text style={styles.bookingPrice}>{b.price_huf.toLocaleString('hu-HU')} Ft</Text>
          </View>
          <Text style={styles.muted}>
            {b.package_size} · {b.length_cm}×{b.width_cm}×{b.height_cm} cm · {b.weight_kg} kg
          </Text>
          <Text style={styles.row}>📍 {b.pickup_address}</Text>
          <Text style={styles.row}>🏁 {b.dropoff_address}</Text>
          {b.notes ? (
            <Text style={[styles.muted, { fontStyle: 'italic', marginTop: 4 }]}>„{b.notes}"</Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 6, marginTop: spacing.sm, flexWrap: 'wrap' }}>
            <View
              style={[
                styles.statusPill,
                b.status === 'confirmed' && { backgroundColor: '#dcfce7' },
                b.status === 'rejected' && { backgroundColor: '#fee2e2' },
              ]}
            >
              <Text style={styles.statusText}>{BOOKING_STATUS_LABEL[b.status]}</Text>
            </View>
            {/* Fizetés állapot — csak confirmed+ státusznál érdekes. */}
            {['confirmed', 'in_progress', 'delivered'].includes(b.status) && (
              b.paid_at ? (
                <View style={styles.paidPill}>
                  <Text style={styles.paidPillText}>✅ FIZETVE</Text>
                </View>
              ) : (
                <View style={styles.awaitingPill}>
                  <Text style={styles.awaitingPillText}>⏳ Fizetésre vár</Text>
                </View>
              )
            )}
          </View>
          {b.status === 'pending' && (
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Pressable style={styles.confirmBtn} onPress={() => confirmBooking(b.id)}>
                <Text style={styles.confirmBtnText}>Elfogadom</Text>
              </Pressable>
              <Pressable style={styles.rejectBtn} onPress={() => rejectBooking(b.id)}>
                <Text style={styles.rejectBtnText}>Elutasítom</Text>
              </Pressable>
            </View>
          )}
          {/* Lemondás már elfogadott foglalásra (sofőri 100% refund) */}
          {b.status === 'confirmed' && (
            <Pressable style={styles.cancelBookingBtn} onPress={() => cancelBookingPress(b)}>
              <Text style={styles.cancelBookingBtnText}>❌ Lemondás</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  muted: { color: colors.textMuted, fontSize: 13 },
  row: { color: colors.text, marginTop: 2, fontSize: 14 },
  description: { color: colors.text, lineHeight: 20, fontSize: 14, marginTop: 8 },

  editBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  editBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  publishBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  publishBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionLabel: {
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tagText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  tagIndex: { fontSize: 10, opacity: 0.7, fontWeight: '400' },
  priceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priceChip: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    alignItems: 'center',
    minWidth: 70,
  },
  priceChipSize: { fontWeight: '800', fontSize: 14, color: colors.text },
  priceChipAmount: { color: colors.primary, fontWeight: '700', marginTop: 2 },

  bookingCard: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bookingHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  bookingShipper: { fontSize: 15, fontWeight: '700', color: colors.text },
  bookingPrice: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  statusPill: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontWeight: '700', color: colors.text },

  paidPill: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  paidPillText: { fontSize: 11, fontWeight: '800', color: '#166534' },
  awaitingPill: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  awaitingPillText: { fontSize: 11, fontWeight: '700', color: '#92400e' },

  confirmBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  confirmBtnText: { color: '#fff', fontWeight: '700' },
  rejectBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.danger,
  },
  rejectBtnText: { color: colors.danger, fontWeight: '700' },

  cancelBookingBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
  },
  cancelBookingBtnText: { color: colors.danger, fontWeight: '700', fontSize: 12 },
});
