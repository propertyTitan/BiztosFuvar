// =====================================================================
//  FUVAR LEZÁRÁSA – a "Bizalmi Lánc" záró képernyője.
//
//  Kötelező lépések, sorrendben:
//   1) Kamera engedély + fotó készítése a lerakodott áruról
//   2) GPS koordináta lekérése (foreground engedély)
//   3) Lokális ellenőrzés: a célhelytől legfeljebb 50 m-re vagyunk-e
//   4) Fotó + GPS feltöltése a backendre (kind: 'dropoff')
//   5) A backend validál + Barion finishReservation → 90/10 split
//   6) Sikeres válasz esetén kifizetés státusz megjelenítése
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

const MAX_DROPOFF_DISTANCE_M = 50;

type Step = 'camera' | 'preview' | 'uploading' | 'done';

export default function FuvarLezarasa() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const camRef = useRef<CameraView>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const [job, setJob] = useState<any>(null);
  const [step, setStep] = useState<Step>('camera');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [result, setResult] = useState<any>(null);

  // Fuvar betöltése (kell a célkoordináta a lokális távolságszámításhoz)
  useEffect(() => {
    api.getJob(id!).then(setJob).catch((e) => Alert.alert('Hiba', e.message));
  }, [id]);

  // Kamera engedély kérés
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  if (!job) {
    return <Centered><ActivityIndicator color={colors.primary} /></Centered>;
  }

  if (!permission?.granted) {
    return (
      <Centered>
        <Text style={styles.helpText}>
          A fuvar lezárásához szükségünk van a kamera használatára.
        </Text>
        <Pressable style={styles.cta} onPress={requestPermission}>
          <Text style={styles.ctaText}>Engedély megadása</Text>
        </Pressable>
      </Centered>
    );
  }

  async function takePhoto() {
    if (!camRef.current) return;
    try {
      // 1) GPS engedély
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Hiba', 'A fuvar lezárásához GPS hozzáférés szükséges.');
        return;
      }

      // 2) Fotó + GPS párhuzamosan
      const [photo, pos] = await Promise.all([
        camRef.current.takePictureAsync({ quality: 0.7, base64: false, exif: false }),
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      ]);

      const coords = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? 0,
      };

      // 3) Lokális távolságszámítás (azonnali visszajelzés a sofőrnek)
      const d = Math.round(
        haversineMeters(coords.lat, coords.lng, job.dropoff_lat, job.dropoff_lng),
      );

      setPhotoUri(photo!.uri);
      setGps(coords);
      setDistanceM(d);
      setStep('preview');
    } catch (e: any) {
      Alert.alert('Hiba a fotó készítésekor', e.message);
    }
  }

  async function uploadAndFinalize() {
    if (!photoUri || !gps) return;

    if (distanceM != null && distanceM > MAX_DROPOFF_DISTANCE_M) {
      Alert.alert(
        'Túl messze a céltól',
        `${distanceM} m-re vagy a céltól. Csak ${MAX_DROPOFF_DISTANCE_M} m-en belül lehet lezárni a fuvart.`,
      );
      return;
    }

    setStep('uploading');
    try {
      const res = await api.uploadPhoto({
        jobId: id!,
        kind: 'dropoff',
        fileUri: photoUri,
        gps_lat: gps.lat,
        gps_lng: gps.lng,
        gps_accuracy_m: gps.accuracy,
      });
      setResult(res);
      setStep('done');
    } catch (e: any) {
      setStep('preview');
      Alert.alert('Sikertelen feltöltés', e.message);
    }
  }

  // ---------- RENDER ----------

  if (step === 'camera') {
    return (
      <View style={{ flex: 1 }}>
        <CameraView ref={camRef} style={{ flex: 1 }} facing="back" />
        <View style={styles.bottomBar}>
          <Text style={styles.bottomLabel}>
            Készíts fotót a lerakodott áruról a célhelyen
          </Text>
          <Pressable style={styles.shutter} onPress={takePhoto}>
            <View style={styles.shutterInner} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (step === 'preview') {
    const ok = distanceM != null && distanceM <= MAX_DROPOFF_DISTANCE_M;
    return (
      <ScrollView contentContainerStyle={styles.previewContainer}>
        <Text style={styles.title}>Ellenőrzés</Text>

        <View style={[styles.banner, ok ? styles.bannerOk : styles.bannerErr]}>
          <Text style={styles.bannerText}>
            {ok
              ? `✓ A célhelyhez közel vagy (${distanceM} m)`
              : `✗ Túl messze vagy a céltól (${distanceM} m). Maximum ${MAX_DROPOFF_DISTANCE_M} m engedélyezett.`}
          </Text>
        </View>

        <Section label="Cél">
          <Text>{job.dropoff_address}</Text>
        </Section>
        <Section label="Aktuális GPS">
          <Text>
            {gps?.lat.toFixed(5)}, {gps?.lng.toFixed(5)} (±{Math.round(gps?.accuracy ?? 0)} m)
          </Text>
        </Section>

        <Pressable
          style={[styles.cta, !ok && styles.ctaDisabled]}
          disabled={!ok}
          onPress={uploadAndFinalize}
        >
          <Text style={styles.ctaText}>Lezárás és kifizetés indítása</Text>
        </Pressable>
        <Pressable style={[styles.cta, styles.ctaSecondary]} onPress={() => setStep('camera')}>
          <Text style={[styles.ctaText, { color: colors.primary }]}>Új fotó</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (step === 'uploading') {
    return (
      <Centered>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.helpText}>Fotó feltöltése és Barion fizetés indítása...</Text>
      </Centered>
    );
  }

  // step === 'done'
  const validation = result?.validation;
  const payout = validation?.payout;
  return (
    <ScrollView contentContainerStyle={styles.previewContainer}>
      <Text style={styles.title}>Sikeres lezárás 🎉</Text>
      <View style={[styles.banner, styles.bannerOk]}>
        <Text style={styles.bannerText}>A fuvar átadottnak minősítve.</Text>
      </View>
      {payout && (
        <Section label="Kifizetés (Barion split)">
          <Text>Teljes összeg: {payout.total_huf?.toLocaleString('hu-HU')} Ft</Text>
          <Text style={{ color: colors.success, fontWeight: '700' }}>
            Sofőri rész (90%): {payout.carrier_share_huf?.toLocaleString('hu-HU')} Ft
          </Text>
          <Text style={{ color: colors.textMuted }}>
            Platform jutalék (10%): {payout.platform_share_huf?.toLocaleString('hu-HU')} Ft
          </Text>
          {payout.stub && (
            <Text style={styles.stub}>STUB mód – élesben Barionon keresztül történik.</Text>
          )}
        </Section>
      )}
      <Pressable style={styles.cta} onPress={() => router.replace('/fuvarok')}>
        <Text style={styles.ctaText}>Vissza a fuvarokhoz</Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------- segédek ----------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  helpText: { color: colors.textMuted, marginBottom: spacing.md, textAlign: 'center' },
  bottomBar: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: spacing.lg,
    alignItems: 'center',
  },
  bottomLabel: { color: '#fff', marginBottom: spacing.md, textAlign: 'center' },
  shutter: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },

  previewContainer: { padding: spacing.lg },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginBottom: spacing.md },

  banner: { padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  bannerOk: { backgroundColor: '#DCFCE7' },
  bannerErr: { backgroundColor: '#FEE2E2' },
  bannerText: { color: colors.text, fontWeight: '600' },

  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.xs },

  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  ctaDisabled: { backgroundColor: colors.textMuted },
  ctaSecondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  stub: { color: colors.warning, marginTop: spacing.sm, fontSize: 12 },
});
