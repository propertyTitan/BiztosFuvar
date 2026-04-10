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
import TruckLoader from '@/components/TruckLoader';
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

  function cancelJobPress() {
    if (!job) return;
    const wasPaid = !!job.paid_at;
    const message = wasPaid
      ? 'Biztosan lemondod a fuvart? A 10% lemondási díjat (max 1000 Ft) levonjuk a Barion visszatérítésből.'
      : 'Biztosan lemondod a fuvart? Még nem volt fizetés, díj sincs.';
    Alert.alert('Lemondás', message, [
      { text: 'Mégse' },
      {
        text: 'Lemondom',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await api.cancelJob(id!);
            const msg =
              res.refund_huf > 0
                ? `Visszatérítés: ${res.refund_huf.toLocaleString('hu-HU')} Ft${res.cancellation_fee_huf > 0 ? ` (díj: ${res.cancellation_fee_huf.toLocaleString('hu-HU')} Ft)` : ''}.`
                : undefined;
            toast.success('Fuvar lemondva', msg);
            await load();
          } catch (e: any) {
            toast.error('Lemondás sikertelen', e.message);
          }
        },
      },
    ]);
  }

  if (!job) return <TruckLoader />;

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

      {/* Az átvételi kód most az oldal aljára került, az elfogadott ár mellé */}

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

      {/* Vita indítása */}
      {['in_progress', 'delivered'].includes(job.status) && (
        <View style={[styles.section, { backgroundColor: '#fefce8', borderColor: '#f59e0b' }]}>
          <Text style={[styles.sectionLabel, { color: '#92400e' }]}>Probléma van?</Text>
          <Text style={{ color: '#92400e', fontSize: 13, marginBottom: spacing.sm, lineHeight: 18 }}>
            Ha a csomagod sérült, nem érkezett meg, vagy egyéb gond van — indíts egy vitás esetet.
          </Text>
          <Pressable
            style={[styles.payBtn, { backgroundColor: '#d97706' }]}
            onPress={() => {
              Alert.prompt
                ? Alert.prompt('Vitás eset', 'Írd le mi a probléma:', async (desc) => {
                    if (!desc?.trim()) return;
                    try {
                      await api.openDispute({ job_id: id!, description: desc });
                      toast.info('Vitás eset megnyitva', 'Az admin hamarosan felülvizsgálja.');
                      load();
                    } catch (e: any) {
                      toast.error('Hiba', e.message);
                    }
                  })
                : Alert.alert('Vitás eset', 'Írd le a problémát az AI Segédnek vagy az értesítések oldalon.', [{ text: 'OK' }]);
            }}
          >
            <Text style={styles.payBtnText}>⚖️ Vitás esetet nyitok</Text>
          </Pressable>
        </View>
      )}

      {job.status === 'disputed' && (
        <View style={[styles.section, { backgroundColor: '#fef3c7', borderColor: '#f59e0b' }]}>
          <Text style={[styles.sectionLabel, { color: '#92400e' }]}>⚖️ Vitás eset folyamatban</Text>
          <Text style={{ color: '#92400e', fontSize: 13, lineHeight: 18 }}>
            Erre a fuvarra vita van nyitva. Az admin felülvizsgálja a helyzetet.
          </Text>
        </View>
      )}

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

      {/* Átvételi kód — NAGY és feltűnő, az oldal alján, az ár mellett.
          A feladó ezt adja át a sofőrnek az átvételkor → ezzel záródik a fuvar. */}
      {job.delivery_code && !['delivered', 'completed', 'cancelled'].includes(job.status) && (
        <View style={styles.codeCard}>
          <Text style={styles.codeLabel}>🔐 ÁTVÉTELI KÓD</Text>
          <Text style={styles.codeValue}>{job.delivery_code}</Text>
          <View style={styles.codeHintBox}>
            <Text style={styles.codeHint}>
              Add át ezt a 6 jegyű kódot a sofőrnek az átvételkor.{'\n'}
              A sofőr ezzel zárja le a fuvart — nélküle nem kap fizetést.
            </Text>
          </View>
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

      {/* Lemondás gomb — még lemondható állapotban */}
      {!['in_progress', 'delivered', 'completed', 'cancelled'].includes(job.status) && (
        <Pressable style={styles.cancelBtn} onPress={cancelJobPress}>
          <Text style={styles.cancelBtnText}>❌ Fuvar lemondása</Text>
        </Pressable>
      )}

      {/* Lemondott állapot info */}
      {job.status === 'cancelled' && (
        <View style={styles.cancelledBox}>
          <Text style={styles.cancelledTitle}>❌ Ez a fuvar le lett mondva.</Text>
          {job.refund_huf > 0 && (
            <Text style={styles.cancelledBody}>
              Visszatérítve: {job.refund_huf.toLocaleString('hu-HU')} Ft
              {job.cancellation_fee_huf > 0 &&
                ` (díj: ${job.cancellation_fee_huf.toLocaleString('hu-HU')} Ft)`}
            </Text>
          )}
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
    backgroundColor: '#1e40af',
    padding: spacing.lg,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    borderWidth: 3,
    borderColor: '#60a5fa',
    shadowColor: '#1e40af',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  codeLabel: {
    color: '#93c5fd',
    fontSize: 13,
    textTransform: 'uppercase',
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 2,
    marginBottom: spacing.sm,
  },
  codeValue: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 8,
    textAlign: 'center',
    paddingVertical: spacing.md,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  codeHintBox: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  codeHint: {
    color: '#dbeafe',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
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

  cancelBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  cancelBtnText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  cancelledBox: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  cancelledTitle: { color: '#7f1d1d', fontWeight: '800', fontSize: 14 },
  cancelledBody: { color: '#7f1d1d', fontSize: 13, marginTop: 4 },
});
