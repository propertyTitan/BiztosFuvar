// Fuvar részletek + licit feladás + "Fuvar lezárása" gomb (csak in_progress státuszban).
// Új: react-native-maps térkép a felvétel/lerakodás vizualizálásához, és
// in_progress státuszban automatikus GPS ping (a feladó a webes Dashboardon
// élőben látja a sofőr piros pöttyét).
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Alert, ScrollView, Platform,
} from 'react-native';
import { useLocalSearchParams, Link } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

const PING_INTERVAL_MS = 10_000; // 10 másodpercenként frissíti a sofőr pozícióját

export default function FuvarReszletek() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [job, setJob] = useState<any>(null);
  const [bid, setBid] = useState('');
  const [meId, setMeId] = useState<string | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => setMeId(u?.id || null));
  }, []);

  useEffect(() => {
    api.getJob(id!).then(setJob).catch((e) => Alert.alert('Hiba', e.message));
  }, [id]);

  // `job:paid` realtime event: ha a feladó kifizeti a fuvart, a sofőr
  // képernyőjén azonnal cserélődjön a pill "Fizetésre vár" → "FIZETVE"-re.
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    (async () => {
      const u = await getCurrentUser();
      if (!u) return;
      joinUserRoom(u.id);
      const socket = getSocket();
      const onPaid = (p: any) => {
        if (!p || p.job_id === id) {
          api.getJob(id!).then(setJob).catch(() => {});
        }
      };
      socket.on('job:paid', onPaid);
      cleanup = () => socket.off('job:paid', onPaid);
    })();
    return () => cleanup?.();
  }, [id]);

  // Élő GPS ping: amíg a fuvar 'in_progress', a sofőr telefonja 10 mp-enként
  // küldi a pozíciót a backendre, ami Socket.IO-val továbbküldi a feladónak.
  useEffect(() => {
    if (!job || job.status !== 'in_progress') return;

    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;

      const sendPing = async () => {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          await api.pingLocation(
            id!,
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.speed != null ? pos.coords.speed * 3.6 : undefined, // m/s → km/h
          );
        } catch {
          // csendben elnyeljük – nem akarjuk a sofőrt értesítésekkel zaklatni vezetés közben
        }
      };

      sendPing(); // azonnali első ping
      pingTimer.current = setInterval(sendPing, PING_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      if (pingTimer.current) {
        clearInterval(pingTimer.current);
        pingTimer.current = null;
      }
    };
  }, [job?.status, id]);

  async function placeBid() {
    try {
      const amount = parseInt(bid, 10);
      if (!amount) {
        toast.error('Adj meg egy érvényes összeget');
        return;
      }
      await api.placeBid(id!, amount);
      toast.success('Licit elküldve', `${amount.toLocaleString('hu-HU')} Ft`);
      setBid('');
    } catch (e: any) {
      toast.error('Sikertelen licit', e.message);
    }
  }

  if (!job) return <Text style={{ padding: 24 }}>Betöltés...</Text>;

  const canClose = job.status === 'in_progress';
  const region = {
    latitude: (job.pickup_lat + job.dropoff_lat) / 2,
    longitude: (job.pickup_lng + job.dropoff_lng) / 2,
    latitudeDelta: Math.abs(job.pickup_lat - job.dropoff_lat) * 1.6 + 0.5,
    longitudeDelta: Math.abs(job.pickup_lng - job.dropoff_lng) * 1.6 + 0.5,
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{job.title}</Text>
      <Text style={styles.status}>Státusz: {hungarianStatus(job.status)}</Text>

      {/* Fizetés állapot — csak accepted+ státuszoknál. A sofőr ebből
          tudja, hogy a feladó már kifizette-e a fuvart. */}
      {['accepted', 'in_progress', 'delivered'].includes(job.status) && (
        <View style={[styles.payStatus, job.paid_at ? styles.payStatusPaid : styles.payStatusWaiting]}>
          <Text style={[styles.payStatusText, job.paid_at ? styles.payStatusPaidText : styles.payStatusWaitingText]}>
            {job.paid_at ? '✅ FIZETVE' : '⏳ Fizetésre vár'}
          </Text>
        </View>
      )}

      {/* Térkép – pickup → dropoff */}
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

      {job.status === 'in_progress' && (
        <View style={styles.liveBanner}>
          <Text style={styles.liveBannerText}>🔴 Élő követés aktív – pozíciód továbbítva a feladónak</Text>
        </View>
      )}

      <Section label="Felvétel">
        <Text style={styles.row}>{job.pickup_address}</Text>
      </Section>
      <Section label="Lerakodás">
        <Text style={styles.row}>{job.dropoff_address}</Text>
      </Section>
      <Section label="Csomag adatai">
        {job.length_cm && job.width_cm && job.height_cm && (
          <Text style={styles.row}>
            Méret: {job.length_cm} × {job.width_cm} × {job.height_cm} cm
          </Text>
        )}
        {job.volume_m3 != null && (
          <Text style={styles.row}>Térfogat: {job.volume_m3} m³</Text>
        )}
        {job.weight_kg != null && (
          <Text style={styles.row}>Súly: {job.weight_kg} kg</Text>
        )}
        {job.distance_km != null && (
          <Text style={styles.row}>Távolság: {job.distance_km} km</Text>
        )}
        {job.suggested_price_huf && (
          <Text style={[styles.row, { color: colors.primary, fontWeight: '700', marginTop: 4 }]}>
            Javasolt ár: {job.suggested_price_huf.toLocaleString('hu-HU')} Ft
          </Text>
        )}
      </Section>
      {job.description ? (
        <Section label="Leírás a feladótól">
          <Text style={styles.description}>{job.description}</Text>
        </Section>
      ) : null}

      {/* Ha a saját hirdetésedről van szó, nem licitálhatsz — helyette
          egy "Saját poszt" figyelmeztetés és átirányító link a feladói
          részletek oldalra (licitek kezelése / szerkesztés). */}
      {meId && job.shipper_id === meId && (
        <View style={styles.ownPostBox}>
          <Text style={styles.ownPostTitle}>📣 Ez a te saját fuvarod</Text>
          <Text style={styles.ownPostBody}>
            A saját hirdetésedre nem licitálhatsz. Nyisd meg a feladói nézetet
            a licitek áttekintéséhez és a szerkesztéshez.
          </Text>
          <Link
            href={{ pathname: '/feladas/[id]', params: { id: id! } }}
            asChild
          >
            <Pressable style={styles.cta}>
              <Text style={styles.ctaText}>Feladói nézet →</Text>
            </Pressable>
          </Link>
        </View>
      )}

      {meId && job.shipper_id !== meId && (job.status === 'pending' || job.status === 'bidding') && (
        <Section label="Licit feladása">
          <TextInput
            style={styles.input}
            placeholder="Ajánlott ár (Ft)"
            keyboardType="number-pad"
            value={bid}
            onChangeText={setBid}
          />
          <Pressable style={styles.cta} onPress={placeBid}>
            <Text style={styles.ctaText}>Licit elküldése</Text>
          </Pressable>
        </Section>
      )}

      {canClose && (
        <Link href={{ pathname: '/fuvar/[id]/lezaras', params: { id: id! } }} asChild>
          <Pressable style={[styles.cta, styles.bigCta]}>
            <Text style={styles.ctaText}>📸 FUVAR LEZÁRÁSA</Text>
          </Pressable>
        </Link>
      )}
    </ScrollView>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function hungarianStatus(s: string) {
  return ({
    pending: 'Várakozik', bidding: 'Licitálható', accepted: 'Elfogadva',
    in_progress: 'Folyamatban', delivered: 'Lerakva', completed: 'Lezárva',
    disputed: 'Vitatott', cancelled: 'Lemondva',
  } as Record<string, string>)[s] || s;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  status: { color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.sm },
  payStatus: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  payStatusPaid: { backgroundColor: '#dcfce7', borderColor: '#86efac' },
  payStatusWaiting: { backgroundColor: '#fef3c7', borderColor: '#fde68a' },
  payStatusText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  payStatusPaidText: { color: '#166534' },
  payStatusWaitingText: { color: '#92400e' },
  mapWrap: {
    height: 220, borderRadius: radius.md, overflow: 'hidden',
    marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border,
  },
  map: { flex: 1 },
  liveBanner: {
    backgroundColor: '#FEE2E2',
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  liveBannerText: { color: colors.danger, fontWeight: '600', textAlign: 'center' },
  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.xs },
  row: { color: colors.text, marginBottom: 2 },
  description: { color: colors.text, lineHeight: 20, fontSize: 15 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 16, marginBottom: spacing.md, backgroundColor: '#fff',
  },
  cta: {
    backgroundColor: colors.primary, paddingVertical: spacing.md,
    borderRadius: radius.md, alignItems: 'center',
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  bigCta: { paddingVertical: spacing.lg, marginTop: spacing.md },

  ownPostBox: {
    backgroundColor: '#fefce8',
    borderColor: '#facc15',
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  ownPostTitle: { fontSize: 16, fontWeight: '800', color: '#713f12', marginBottom: spacing.xs },
  ownPostBody: { color: '#713f12', fontSize: 14, marginBottom: spacing.sm, lineHeight: 20 },
});
