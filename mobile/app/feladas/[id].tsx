// Feladói fuvar részletek mobilon.
// - Térkép a felvétel/lerakodás pontokkal + (ha van) élő sofőr pozíció.
// - Csomag adatai.
// - Hirdetési fotók galériája (amit a webes feladásnál töltött fel).
// - Beérkezett licitek listája "Elfogadom" gombbal.
// - Elfogadott licit után "Fizetés Barionnal" gomb — sikeres fizetés
//   után a gomb helyén FIZETVE címke marad.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, Image, Alert, Platform, Linking,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import { useToast } from '@/components/ToastProvider';
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

export default function FeladoiFuvarReszletek() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [job, setJob] = useState<any>(null);
  const [bids, setBids] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [j, b, p] = await Promise.all([
        api.getJob(id!),
        api.listBids(id!),
        api.listPhotos(id!),
      ]);
      setJob(j);
      setBids(b);
      setPhotos(p);
    } catch (err: any) {
      Alert.alert('Hiba', err.message);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Real-time: ha a fizetés befejeződik (akár a mobilon, akár a weben),
  // a `job:paid` event frissíti a fuvart — lecserélődik a gomb a
  // FIZETVE címkére automatikusan.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      const u = await getCurrentUser();
      if (!u) return;
      joinUserRoom(u.id);
      const socket = getSocket();
      const onPaid = (p: any) => {
        if (!p || p.job_id === id) load();
      };
      socket.on('job:paid', onPaid);
      cleanup = () => socket.off('job:paid', onPaid);
    })();
    return () => cleanup?.();
  }, [id, load]);

  async function acceptBid(bidId: string) {
    try {
      await api.acceptBid(bidId);
      await load();
      toast.success('Licit elfogadva', 'Most már kifizetheted a fuvart.');
    } catch (err: any) {
      toast.error('Hiba a licit elfogadásakor', err.message);
    }
  }

  async function startPayment() {
    setPaying(true);
    try {
      const r = await api.payJob(id!);
      if (r.is_stub) {
        router.push({ pathname: '/fizetes-stub', params: { job: id } });
      } else {
        await Linking.openURL(r.gateway_url);
      }
    } catch (e: any) {
      toast.error('Fizetés indítása sikertelen', e.message);
    } finally {
      setPaying(false);
    }
  }

  if (!job) return <Text style={{ padding: 24 }}>Betöltés…</Text>;

  const listingPhotos = photos.filter((p) => p.kind === 'listing');
  const region = {
    latitude: (job.pickup_lat + job.dropoff_lat) / 2,
    longitude: (job.pickup_lng + job.dropoff_lng) / 2,
    latitudeDelta: Math.abs(job.pickup_lat - job.dropoff_lat) * 1.6 + 0.5,
    longitudeDelta: Math.abs(job.pickup_lng - job.dropoff_lng) * 1.6 + 0.5,
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.status}>Státusz: {STATUS_LABEL[job.status] || job.status}</Text>

      {/* Térkép */}
      <View style={styles.mapWrap}>
        <MapView
          style={styles.map}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={region}
        >
          <Marker
            coordinate={{ latitude: job.pickup_lat, longitude: job.pickup_lng }}
            title="Felvétel"
            description={job.pickup_address}
            pinColor={colors.success}
          />
          <Marker
            coordinate={{ latitude: job.dropoff_lat, longitude: job.dropoff_lng }}
            title="Lerakodás"
            description={job.dropoff_address}
            pinColor={colors.danger}
          />
          <Polyline
            coordinates={[
              { latitude: job.pickup_lat, longitude: job.pickup_lng },
              { latitude: job.dropoff_lat, longitude: job.dropoff_lng },
            ]}
            strokeColor={colors.primary}
            strokeWidth={4}
          />
        </MapView>
      </View>

      {/* Átvételi kód – csak a feladó látja */}
      {job.delivery_code && !['delivered', 'completed', 'cancelled'].includes(job.status) && (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>🔐 Átvételi kód</Text>
          <Text style={styles.codeValue}>{job.delivery_code}</Text>
          <Text style={styles.codeHint}>
            Add át ezt a 6 jegyű kódot a sofőrnek, amikor átveszi tőled (vagy a
            címzettől) a csomagot. A sofőr ezzel tudja lezárni a fuvart.
          </Text>
        </View>
      )}

      {/* Hirdetési fotók */}
      {listingPhotos.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Fotók</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {listingPhotos.map((p) => (
              <Image
                key={p.id}
                source={{ uri: p.url }}
                style={styles.thumb}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Csomag adatai */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Csomag</Text>
        {job.length_cm && job.width_cm && job.height_cm && (
          <Text style={styles.row}>
            Méret: {job.length_cm} × {job.width_cm} × {job.height_cm} cm
          </Text>
        )}
        {job.volume_m3 != null && <Text style={styles.row}>Térfogat: {job.volume_m3} m³</Text>}
        {job.weight_kg != null && <Text style={styles.row}>Súly: {job.weight_kg} kg</Text>}
        {job.distance_km != null && <Text style={styles.row}>Távolság: {job.distance_km} km</Text>}
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Cím</Text>
        <Text style={styles.row}>📍 {job.pickup_address}</Text>
        <Text style={styles.row}>🏁 {job.dropoff_address}</Text>
      </View>
      {job.description ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Leírás</Text>
          <Text style={styles.description}>{job.description}</Text>
        </View>
      ) : null}

      {/* Licitek */}
      {(job.status === 'pending' || job.status === 'bidding') && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Beérkezett licitek ({bids.length})
          </Text>
          {bids.length === 0 && (
            <Text style={styles.muted}>
              Még nincs licit. A sofőrök hamarosan ajánlatot tesznek.
            </Text>
          )}
          {bids.map((b) => (
            <View key={b.id} style={styles.bidRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.bidAmount}>
                  {b.amount_huf.toLocaleString('hu-HU')} Ft
                </Text>
                {b.carrier_name && (
                  <Text style={styles.muted}>
                    {b.carrier_name}
                    {b.rating_avg ? ` · ⭐ ${Number(b.rating_avg).toFixed(1)}` : ''}
                    {b.eta_minutes ? ` · ~${b.eta_minutes} perc` : ''}
                  </Text>
                )}
                {b.message ? (
                  <Text style={styles.muted} numberOfLines={2}>
                    „{b.message}"
                  </Text>
                ) : null}
              </View>
              <Pressable style={styles.acceptBtn} onPress={() => acceptBid(b.id)}>
                <Text style={styles.acceptBtnText}>Elfogadom</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Elfogadott ár + fizetés / FIZETVE */}
      {job.accepted_price_huf && (
        <View style={[styles.section, { backgroundColor: '#eff6ff' }]}>
          <Text style={styles.sectionLabel}>Elfogadott fuvardíj</Text>
          <Text style={styles.bidAmount}>
            {job.accepted_price_huf.toLocaleString('hu-HU')} Ft
          </Text>

          {job.paid_at ? (
            <View style={styles.paidBox}>
              <Text style={styles.paidText}>✅ FIZETVE</Text>
            </View>
          ) : job.status === 'accepted' ? (
            <Pressable
              style={[styles.payBtn, paying && { opacity: 0.7 }]}
              disabled={paying}
              onPress={startPayment}
            >
              <Text style={styles.payBtnText}>
                {paying ? 'Fizetés indítása…' : '💳 Fizetés Barionnal'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  status: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.md },
  mapWrap: {
    height: 220,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  map: { flex: 1 },

  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionLabel: {
    fontSize: 12,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  row: { color: colors.text, marginBottom: 2 },
  description: { color: colors.text, lineHeight: 20, fontSize: 15 },
  muted: { color: colors.textMuted, fontSize: 13 },

  codeCard: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  codeLabel: {
    color: '#fff',
    fontSize: 12,
    textTransform: 'uppercase',
    opacity: 0.85,
    marginBottom: spacing.sm,
    fontWeight: '600',
  },
  codeValue: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  codeHint: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.9,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
  thumb: {
    width: 120,
    height: 120,
    borderRadius: radius.sm,
    marginRight: spacing.sm,
    backgroundColor: colors.border,
  },

  bidRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  bidAmount: { color: colors.primary, fontWeight: '700', fontSize: 16 },
  acceptBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  acceptBtnText: { color: '#fff', fontWeight: '700' },

  payBtn: {
    backgroundColor: '#16a34a',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  payBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  paidBox: {
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#86efac',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  paidText: { color: '#166534', fontWeight: '800', fontSize: 15, letterSpacing: 0.5 },
});
