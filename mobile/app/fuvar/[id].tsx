// Fuvar részletek + licit feladás + "Fuvar lezárása" gomb (csak in_progress státuszban).
// Új: react-native-maps térkép a felvétel/lerakodás vizualizálásához, és
// in_progress státuszban automatikus GPS ping (a feladó a webes Dashboardon
// élőben látja a sofőr piros pöttyét).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Alert, ScrollView, Platform, Keyboard,
  InputAccessoryView, Button,
} from 'react-native';
import { useLocalSearchParams, Link } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { startBackgroundTracking, stopBackgroundTracking } from '@/services/backgroundTracking';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import { useToast } from '@/components/ToastProvider';
import TruckLoader from '@/components/TruckLoader';
import { colors, spacing, radius } from '@/theme';

const PING_INTERVAL_MS = 60_000; // 60 másodpercenként frissíti a sofőr pozícióját

export default function FuvarReszletek() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const [job, setJob] = useState<any>(null);
  const [bid, setBid] = useState('');
  const [meId, setMeId] = useState<string | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Chat state
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => setMeId(u?.id || null));
  }, []);

  useEffect(() => {
    api.getJob(id!).then(setJob).catch((e) => Alert.alert('Hiba', e.message));
  }, [id]);

  // Chat üzenetek betöltése (ha a fuvar accepted+ és van carrier)
  useEffect(() => {
    if (!job || !job.carrier_id || !['accepted', 'in_progress', 'delivered', 'completed'].includes(job.status)) return;
    api.getMessages({ job_id: id! }).then(setChatMessages).catch(() => {});
    // Real-time: Socket.IO-ból érkező új üzenetek
    const socket = getSocket();
    const roomKey = `chat:job:${id}`;
    const onMsg = (msg: any) => {
      setChatMessages((prev) => prev.some((m: any) => m.id === msg.id) ? prev : [...prev, msg]);
    };
    socket.on(roomKey, onMsg);
    return () => { socket.off(roomKey, onMsg); };
  }, [job?.status, job?.carrier_id, id]);

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    setChatSending(true);
    try {
      const msg = await api.sendMessage({ job_id: id!, body: text });
      setChatMessages((prev) => prev.some((m: any) => m.id === msg.id) ? prev : [...prev, msg]);
      setChatInput('');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setChatSending(false);
    }
  }

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

  // Élő GPS tracking: amíg a fuvar 'in_progress', a háttér tracking szolgáltatás
  // küldi a pozíciót — lezárt képernyőnél is működik (expo-task-manager).
  // Android: notification bar-ban "GoFuvar — Élő követés" jelenik meg.
  // iOS: kék sáv a képernyő tetején.
  useEffect(() => {
    if (!job || job.status !== 'in_progress') return;

    startBackgroundTracking(id!).then((started) => {
      if (!started) {
        // Ha nem sikerült a háttér engedélyt megkapni, fallback foreground polling
        console.warn('[tracking] háttér engedély megtagadva, foreground fallback');
        let cancelled = false;
        const sendPing = async () => {
          try {
            const pos = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
            });
            await api.pingLocation(
              id!,
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.speed != null ? pos.coords.speed * 3.6 : undefined,
            );
          } catch {}
        };
        sendPing();
        pingTimer.current = setInterval(sendPing, PING_INTERVAL_MS);
      }
    });

    return () => {
      // Ha a fuvar lezárul vagy az oldalt elhagyjuk → leállítjuk a tracking-et
      stopBackgroundTracking();
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

  // Fuvar indítása: az "accepted" státuszú fuvarban a sofőr fotót
  // készít a felvett csomagról (pickup fotó) → a backend automatikusan
  // átállítja "in_progress"-re → élő GPS követés indul.
  async function startJob() {
    try {
      const { status: camStatus } = await ImagePicker.requestCameraPermissionsAsync();
      if (camStatus !== 'granted') {
        Alert.alert('Kamera engedély kell', 'A felvételi fotóhoz engedélyezd a kamerát.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;

      toast.info('Felvételi fotó feltöltése…');
      let gpsLat, gpsLng;
      try {
        const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
        if (locStatus === 'granted') {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          gpsLat = pos.coords.latitude;
          gpsLng = pos.coords.longitude;
        }
      } catch {}

      await api.uploadPhoto({
        jobId: id!,
        kind: 'pickup',
        fileUri: result.assets[0].uri,
        fileName: 'pickup.jpg',
        mimeType: 'image/jpeg',
        gps_lat: gpsLat,
        gps_lng: gpsLng,
      });
      toast.success('Fuvar elindítva!', 'Élő GPS követés aktív.');
      api.getJob(id!).then(setJob);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    }
  }

  if (!job) return <TruckLoader />;

  const canClose = job.status === 'in_progress';
  const region = {
    latitude: (job.pickup_lat + job.dropoff_lat) / 2,
    longitude: (job.pickup_lng + job.dropoff_lng) / 2,
    latitudeDelta: Math.abs(job.pickup_lat - job.dropoff_lat) * 1.6 + 0.5,
    longitudeDelta: Math.abs(job.pickup_lng - job.dropoff_lng) * 1.6 + 0.5,
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={() => Keyboard.dismiss()}
    >
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
            inputAccessoryViewID="bidKeyboardBar"
          />
          <Pressable style={styles.cta} onPress={placeBid}>
            <Text style={styles.ctaText}>Licit elküldése</Text>
          </Pressable>
        </Section>
      )}

      {/* iOS: "Kész" toolbar a szám-billentyűzet TETEJÉN — ez az egyetlen
          mód amivel az iOS number-pad bezárható. Android-on nincs hatása. */}
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="bidKeyboardBar">
          <View style={styles.keyboardBar}>
            <View style={{ flex: 1 }} />
            <Button title="Kész ✓" onPress={() => Keyboard.dismiss()} color={colors.primary} />
          </View>
        </InputAccessoryView>
      )}

      {/* Chat — elfogadott licit után a feladó és sofőr üzenhetnek egymásnak */}
      {job.carrier_id && ['accepted', 'in_progress', 'delivered', 'completed'].includes(job.status) && (
        <View style={styles.chatSection}>
          <Text style={styles.chatTitle}>💬 Chat a fuvarpartnerrel</Text>
          <View style={styles.chatMessages}>
            {chatMessages.length === 0 && (
              <Text style={styles.chatEmpty}>Még nincs üzenet. Írj először!</Text>
            )}
            {chatMessages.map((m: any) => (
              <View
                key={m.id}
                style={[
                  styles.chatBubble,
                  m.sender_id === meId ? styles.chatBubbleMine : styles.chatBubbleOther,
                ]}
              >
                {m.sender_id !== meId && (
                  <Text style={styles.chatSender}>{m.sender_name}</Text>
                )}
                <Text style={m.sender_id === meId ? styles.chatTextMine : styles.chatTextOther}>
                  {m.body}
                </Text>
                <Text style={styles.chatTime}>
                  {new Date(m.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            ))}
          </View>
          <View style={styles.chatInputRow}>
            <TextInput
              style={styles.chatInput}
              value={chatInput}
              onChangeText={setChatInput}
              placeholder="Írj üzenetet…"
              editable={!chatSending}
              returnKeyType="send"
              onSubmitEditing={sendChatMessage}
              blurOnSubmit={false}
            />
            <Pressable
              style={[styles.chatSendBtn, (!chatInput.trim() || chatSending) && { opacity: 0.4 }]}
              onPress={sendChatMessage}
              disabled={!chatInput.trim() || chatSending}
            >
              <Text style={styles.chatSendText}>Küldés</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Fuvar indítása: accepted állapotban a sofőr készít egy felvételi
          fotót, ami átváltja in_progress-re → élő GPS indul. */}
      {job.status === 'accepted' && (
        <Pressable style={[styles.cta, styles.bigCta, { backgroundColor: '#16a34a' }]} onPress={startJob}>
          <Text style={styles.ctaText}>📸 FUVAR INDÍTÁSA (felvételi fotó)</Text>
        </Pressable>
      )}

      {canClose && (
        <View style={styles.closeCtaWrap}>
          <Link href={{ pathname: '/fuvar/[id]/lezaras', params: { id: id! } }} asChild>
            <Pressable style={styles.closeCta}>
              <Text style={styles.closeCtaIcon}>📸</Text>
              <Text style={styles.closeCtaTitle}>FUVAR LEZÁRÁSA</Text>
              <Text style={styles.closeCtaSub}>Lerakodási fotó + 6 jegyű átvételi kód</Text>
            </Pressable>
          </Link>
        </View>
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
  closeCtaWrap: {
    marginVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  closeCta: {
    backgroundColor: '#dc2626',
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#fca5a5',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 14,
    elevation: 10,
  },
  closeCtaIcon: { fontSize: 40, marginBottom: spacing.sm },
  closeCtaTitle: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 22,
    letterSpacing: 1,
    textAlign: 'center',
  },
  closeCtaSub: {
    color: '#fecaca',
    fontSize: 13,
    marginTop: spacing.xs,
    textAlign: 'center',
  },

  ownPostBox: {
    backgroundColor: '#fefce8',
    borderColor: '#facc15',
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  keyboardBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f1f5f9',
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
  },
  ownPostTitle: { fontSize: 16, fontWeight: '800', color: '#713f12', marginBottom: spacing.xs },
  ownPostBody: { color: '#713f12', fontSize: 14, marginBottom: spacing.sm, lineHeight: 20 },

  chatSection: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  chatTitle: {
    padding: spacing.md,
    backgroundColor: colors.primary,
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  chatMessages: {
    padding: spacing.sm,
    maxHeight: 250,
    gap: 6,
  },
  chatEmpty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', padding: spacing.md },
  chatBubble: {
    padding: spacing.sm,
    borderRadius: radius.md,
    maxWidth: '80%',
  },
  chatBubbleMine: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  chatBubbleOther: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chatSender: { fontSize: 10, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  chatTextMine: { color: '#fff', fontSize: 14 },
  chatTextOther: { color: colors.text, fontSize: 14 },
  chatTime: { fontSize: 9, opacity: 0.6, marginTop: 2, textAlign: 'right' },
  chatInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chatInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  chatSendBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  chatSendText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
