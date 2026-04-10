// =====================================================================
//  FUVAR LEZÁRÁSA – a "Bizalmi Lánc" záró képernyője.
//
//  Új, kód alapú flow:
//   1) Kamera engedély + fotó készítése a lerakodott áruról
//   2) Háttérben megkérjük a GPS-t is (nem blokkoló; log-szerűen
//      rögzítődik bizonyítékként, vita esetén pontosan kiderül,
//      hol volt a sofőr az átadás pillanatában)
//   3) A sofőr beírja a feladótól kapott 6 SZÁMJEGYŰ ÁTVÉTELI KÓDOT
//   4) Fotó + kód + (opcionális) GPS feltöltése → backend validálja a kódot
//   5) Sikeres validáció után Barion finishReservation → 90/10 split
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, ScrollView, TextInput, Keyboard,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

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
  const [code, setCode] = useState('');
  const [result, setResult] = useState<any>(null);

  // Fuvar betöltése
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
      // Kép készítés. Közben NEM blokkoljuk a GPS-re – az csak log-szerűen
      // megy, ha a sofőr megengedi.
      const photo = await camRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
        exif: false,
      });
      setPhotoUri(photo!.uri);
      setStep('preview');

      // GPS-t a háttérben próbáljuk megszerezni, ha elérhető.
      // Nem blokkolunk rá: a fuvar lezáráshoz nem szükséges, csak bizonyíték.
      Location.getForegroundPermissionsAsync().then(async ({ status }) => {
        if (status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status !== 'granted') return;
        }
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setGps({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 0,
          });
        } catch {
          // csendben elnyeljük – nem kell blokkolnunk a sofőrt
        }
      });
    } catch (e: any) {
      Alert.alert('Hiba a fotó készítésekor', e.message);
    }
  }

  async function uploadAndFinalize() {
    if (!photoUri) return;
    if (code.trim().length !== 6) {
      Alert.alert('Érvénytelen kód', 'A 6 számjegyű átvételi kódot kérd el a feladótól vagy az átvevőtől.');
      return;
    }

    setStep('uploading');
    try {
      const res = await api.uploadPhoto({
        jobId: id!,
        kind: 'dropoff',
        fileUri: photoUri,
        delivery_code: code.trim(),
        // GPS-t akkor is elküldjük, ha be tudtuk szerezni (log / bizonyíték)
        gps_lat: gps?.lat,
        gps_lng: gps?.lng,
        gps_accuracy_m: gps?.accuracy,
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
    return (
      <ScrollView
        contentContainerStyle={styles.previewContainer}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Átvételi kód</Text>
        <Text style={styles.helpText}>
          Kérd el a feladótól (vagy az átvevőtől) a{'\n'}6 számjegyű átvételi kódot, és írd be ide.
        </Text>

        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => {
            const clean = t.replace(/[^0-9]/g, '').slice(0, 6);
            setCode(clean);
            // Ha mind a 6 szám megvan, automatikusan bezárjuk a billentyűzetet
            if (clean.length === 6) Keyboard.dismiss();
          }}
          placeholder="······"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => {
            // 6 jegy beírva → billentyűzet eltűnik, és ha kész a kód
            // a "Lezárás" gombra fókuszálhat a user
          }}
          blurOnSubmit
        />

        <Section label="Cél">
          <Text style={styles.row}>{job.dropoff_address}</Text>
        </Section>

        {gps ? (
          <Section label="Rögzített GPS (bizonyíték)">
            <Text style={styles.row}>
              {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} (±{Math.round(gps.accuracy)} m)
            </Text>
          </Section>
        ) : (
          <Section label="GPS">
            <Text style={styles.muted}>
              Nem sikerült lekérni a pozíciót – a lezáráshoz nem szükséges,
              csak vita esetén segítene.
            </Text>
          </Section>
        )}

        <Pressable
          style={[styles.cta, code.length !== 6 && styles.ctaDisabled]}
          disabled={code.length !== 6}
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
        <Text style={styles.helpText}>Fotó feltöltése és Barion fizetés indítása…</Text>
      </Centered>
    );
  }

  // step === 'done'
  const payout = result?.validation?.payout;
  return (
    <ScrollView contentContainerStyle={styles.previewContainer}>
      <Text style={styles.title}>Sikeres lezárás 🎉</Text>
      <View style={[styles.banner, styles.bannerOk]}>
        <Text style={styles.bannerText}>A fuvar átadottnak minősítve.</Text>
      </View>
      {payout && (
        <Section label="Kifizetés (Barion split)">
          <Text style={styles.row}>Teljes összeg: {payout.total_huf?.toLocaleString('hu-HU')} Ft</Text>
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

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  helpText: { color: colors.textMuted, marginBottom: spacing.md, textAlign: 'center', lineHeight: 20 },
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
  bannerText: { color: colors.text, fontWeight: '600' },

  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.border,
  },
  sectionLabel: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.xs },
  row: { color: colors.text, marginBottom: 2 },
  muted: { color: colors.textMuted, fontSize: 13 },

  codeInput: {
    fontSize: 40,
    textAlign: 'center',
    letterSpacing: 8,
    paddingVertical: spacing.md,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: '#fff',
    color: colors.text,
    marginBottom: spacing.md,
    fontWeight: '700',
  },

  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  ctaDisabled: { backgroundColor: colors.textMuted, opacity: 0.6 },
  ctaSecondary: { backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.primary },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  stub: { color: colors.warning, marginTop: spacing.sm, fontSize: 12 },
});
