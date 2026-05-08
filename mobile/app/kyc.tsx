// Jogosítvány-feltöltés (KYC) képernyő.
//
// - Mutatja az aktuális KYC státuszt és a legutóbbi feltöltött doksit.
// - Lehetővé teszi új jogosítvány-fotó feltöltését + manuális adatokat
//   (lejárati dátum kötelező; az okmányszám és a név opcionális, az admin
//   review-nál segít).
// - Sikeres feltöltés után kyc_status → 'pending'; az admin jóváhagyásig
//   nem tud licitálni az új user (vagy a megújítást kérő).
import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, Image, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, KycMe, KycStatus } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius, typography, shadows } from '@/theme';

const STATUS_LABEL: Record<KycStatus, { label: string; color: string }> = {
  none:      { label: 'Nincs feltöltve', color: colors.textMuted },
  pending:   { label: 'Ellenőrzés alatt', color: colors.warning },
  verified:  { label: 'Hitelesítve',      color: colors.success },
  suspended: { label: 'Felfüggesztve',     color: colors.danger },
};

// Egyszerű YYYY-MM-DD validáció + jövőbeli dátum check
function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d >= today;
}

export default function KycScreen() {
  const router = useRouter();
  const toast = useToast();
  const [kyc, setKyc] = useState<KycMe | null>(null);
  const [loading, setLoading] = useState(true);

  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [docNumber, setDocNumber] = useState('');
  const [fullName, setFullName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [consented, setConsented] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.getKycStatus();
      setKyc(r);
      if (r.document) {
        setFullName(r.document.full_name_on_doc || '');
        setDocNumber(r.document.doc_number || '');
        if (r.document.expiry_date) setExpiry(r.document.expiry_date.slice(0, 10));
      }
    } catch (e: any) {
      Alert.alert('Hiba', e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function pickFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Engedély kell', 'A jogosítvány fotózásához engedélyezd a kamerát.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) setPhotoUri(result.assets[0].uri);
  }

  async function pickFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Engedély kell', 'A galéria-hozzáférést engedélyezd.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) setPhotoUri(result.assets[0].uri);
  }

  async function submit() {
    if (!photoUri) {
      Alert.alert('Fotó hiányzik', 'Tölts fel egy fotót a jogosítványról.');
      return;
    }
    if (!validDate(expiry)) {
      Alert.alert(
        'Lejárati dátum',
        'Add meg a jogosítvány lejárati dátumát YYYY-MM-DD formában (pl. 2030-06-15), és csak jövőbeli dátumot.',
      );
      return;
    }
    if (!consented) {
      Alert.alert(
        'Adatkezelési tájékoztató',
        'A feltöltéshez el kell fogadnod az adatkezelési tájékoztatót.',
      );
      return;
    }
    if (!kyc?.consent_version) {
      Alert.alert('Hiba', 'Adatkezelési verzió nem elérhető — frissítsd az appot.');
      return;
    }
    setSubmitting(true);
    try {
      await api.uploadLicense({
        fileUri: photoUri,
        fileName: 'license.jpg',
        mimeType: 'image/jpeg',
        docNumber: docNumber.trim() || undefined,
        fullName: fullName.trim() || undefined,
        expiryDate: expiry,
        consentVersion: kyc.consent_version,
      });
      toast.success('Jogosítvány feltöltve', 'Admin jóváhagyás folyamatban.');
      setPhotoUri(null);
      load();
    } catch (e: any) {
      toast.error('Sikertelen feltöltés', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator /></View>;
  }

  const status = STATUS_LABEL[kyc?.kyc_status || 'none'];
  const doc = kyc?.document;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Státusz kártya */}
      <View style={styles.statusCard}>
        <Text style={styles.h2}>Jogosítvány hitelesítés</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: status.color }]} />
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
        {kyc?.license_expiry && (
          <Text style={styles.muted}>
            Lejárat: {new Date(kyc.license_expiry).toLocaleDateString('hu-HU')}
          </Text>
        )}
        {doc?.status === 'rejected' && (
          <View style={styles.rejectBox}>
            <Text style={styles.rejectTitle}>⚠️ Az előző feltöltés elutasítva</Text>
            {doc.rejection_reason && (
              <Text style={styles.rejectBody}>Indok: {doc.rejection_reason}</Text>
            )}
          </View>
        )}
        {kyc?.kyc_status === 'pending' && (
          <Text style={styles.infoBox}>
            ⏳ Az adminok rövidesen átnézik a feltöltött dokumentumot. Erről értesítést is kapsz.
          </Text>
        )}
        {!kyc?.can_bid && (
          <Text style={styles.warnBox}>
            🚫 Licitálás jelenleg letiltva. Tölts fel érvényes jogosítványt.
          </Text>
        )}
      </View>

      {/* Feltöltő űrlap */}
      <Text style={styles.h2}>Új jogosítvány feltöltése</Text>
      <Text style={styles.muted}>
        Készíts éles fotót a jogosítványod elülső oldaláról. A nevet, az okmányszámot és a
        lejárati dátumot úgy add meg, ahogy a kártyán szerepel.
      </Text>

      <View style={styles.photoPicker}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} />
        ) : (
          <Text style={styles.photoPlaceholder}>📷 Még nincs kép kiválasztva</Text>
        )}
        <View style={styles.photoBtns}>
          <Pressable style={[styles.btn, styles.btnPrimary]} onPress={pickFromCamera}>
            <Text style={styles.btnPrimaryText}>📷 Kamera</Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.btnSecondary]} onPress={pickFromGallery}>
            <Text style={styles.btnSecondaryText}>🖼 Galéria</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.label}>Név (a jogosítványon szereplő)</Text>
      <TextInput
        value={fullName}
        onChangeText={setFullName}
        placeholder="Pl. Kovács János"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
      />

      <Text style={styles.label}>Okmányszám</Text>
      <TextInput
        value={docNumber}
        onChangeText={setDocNumber}
        placeholder="Pl. AB123456"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="characters"
        style={styles.input}
      />

      <Text style={styles.label}>Lejárati dátum (YYYY-MM-DD)</Text>
      <TextInput
        value={expiry}
        onChangeText={setExpiry}
        placeholder="2030-06-15"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        keyboardType="numbers-and-punctuation"
        style={styles.input}
      />

      {/* Adatkezelési tájékoztató + kötelező checkbox.
          A backend csak akkor fogadja el a feltöltést, ha a checkbox bepipálva
          ÉS a consent_version megegyezik a backend aktuálisával. */}
      <View style={styles.consentBox}>
        <Pressable
          onPress={() => setConsented((v) => !v)}
          style={styles.consentRow}
          hitSlop={8}
        >
          <View style={[styles.checkbox, consented && styles.checkboxChecked]}>
            {consented && <Text style={styles.checkboxTick}>✓</Text>}
          </View>
          <Text style={styles.consentLabel}>
            Elfogadom az adatkezelési tájékoztatót
          </Text>
        </Pressable>

        <Pressable onPress={() => setShowConsent((v) => !v)}>
          <Text style={styles.consentToggle}>
            {showConsent ? '▲ Elrejtés' : '▼ Olvasd el (kötelező KYC-hez)'}
          </Text>
        </Pressable>

        {showConsent && (
          <View style={styles.consentText}>
            <Text style={styles.consentP}>
              <Text style={{ fontWeight: '700' }}>Mit gyűjtünk:</Text> a jogosítvány
              fotóját, a rajta lévő nevet, okmányszámot és a lejárati dátumot.
            </Text>
            <Text style={styles.consentP}>
              <Text style={{ fontWeight: '700' }}>Miért:</Text> jogszabály
              kötelez a fuvarozó-azonosításra (KYC), és ezzel védjük a feladókat
              attól, hogy nem-jogosított sofőrhöz kerüljön a csomagjuk.
            </Text>
              <Text style={styles.consentP}>
              <Text style={{ fontWeight: '700' }}>Ki látja:</Text> KIZÁRÓLAG
              te magad és a GoFuvar adminisztrátorok a hitelesítés idejére.
              Más felhasználó NEM látja, és sose kerül publikus URL-re.
            </Text>
            <Text style={styles.consentP}>
              <Text style={{ fontWeight: '700' }}>Hol tároljuk:</Text> EU-régiós
              privát Cloudflare R2 tárolóban, AES-256 titkosítással, csak a
              backendből — auth + jogosultság-check után — érhető el.
            </Text>
            <Text style={styles.consentP}>
              <Text style={{ fontWeight: '700' }}>Meddig:</Text> a hitelesítés
              jóváhagyása után 30 nappal a fotó automatikusan törlődik;
              csak az anonimizált metaadat (név, okmányszám, lejárat) marad
              a státusz fenntartásához. Bármikor kérheted a teljes törlést a
              profilodon a „Fiók törlése" gombbal.
            </Text>
            <Text style={styles.consentP}>
              <Text style={{ fontWeight: '700' }}>Audit log:</Text> minden
              hozzáférés a fotódhoz naplózva van (ki, mikor, mely IP-ről).
              Lekérheted az adatigénylési űrlapunkon.
            </Text>
            <Text style={styles.consentVersion}>
              Verzió: {kyc?.consent_version || '—'}
            </Text>
          </View>
        )}
      </View>

      <Pressable
        style={[
          styles.btn,
          styles.btnSubmit,
          (submitting || !consented) && { opacity: 0.5 },
        ]}
        onPress={submit}
        disabled={submitting || !consented}
      >
        <Text style={styles.btnSubmitText}>
          {submitting ? 'Feltöltés…' : 'Feltöltés és beküldés ellenőrzésre'}
        </Text>
      </Pressable>

      <Pressable onPress={() => router.back()} style={{ marginTop: spacing.md, alignSelf: 'center' }}>
        <Text style={{ color: colors.textMuted }}>Vissza</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.md, paddingBottom: spacing.xxl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  h2: { ...typography.h2, color: colors.text, marginBottom: spacing.xs, marginTop: spacing.md },
  muted: { ...typography.bodySmall, color: colors.textMuted, marginBottom: spacing.sm },
  label: {
    ...typography.bodySmall, color: colors.textSecondary, fontWeight: '600',
    marginTop: spacing.sm, marginBottom: 4,
  },

  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  statusRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: 4,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 16, fontWeight: '700' },

  rejectBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.dangerLight,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  rejectTitle: { fontWeight: '700', color: '#991B1B' },
  rejectBody: { color: '#991B1B', marginTop: 2, ...typography.bodySmall },

  infoBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.primarySubtle,
    color: colors.primaryDark,
    padding: spacing.sm,
    borderRadius: radius.sm,
    ...typography.bodySmall,
  },
  warnBox: {
    marginTop: spacing.sm,
    backgroundColor: colors.warningLight,
    color: '#92400E',
    padding: spacing.sm,
    borderRadius: radius.sm,
    fontWeight: '700',
    ...typography.bodySmall,
  },

  photoPicker: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  photo: { width: '100%', aspectRatio: 1.6, borderRadius: radius.sm, marginBottom: spacing.sm },
  photoPlaceholder: { color: colors.textMuted, marginBottom: spacing.sm },
  photoBtns: { flexDirection: 'row', gap: spacing.sm },

  btn: { paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  btnPrimary: { backgroundColor: colors.primary },
  btnPrimaryText: { color: '#fff', fontWeight: '800' },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnSecondaryText: { color: colors.text, fontWeight: '700' },

  input: {
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },

  btnSubmit: {
    marginTop: spacing.lg,
    backgroundColor: colors.success,
    alignItems: 'center',
  },
  btnSubmitText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  // ── Adatkezelési tájékoztató + checkbox ──
  consentBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: 4,
    borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkboxTick: { color: '#fff', fontWeight: '800', fontSize: 14, lineHeight: 14 },
  consentLabel: { ...typography.body, color: colors.text, flex: 1 },
  consentToggle: {
    color: colors.primary, marginTop: spacing.sm, fontWeight: '600', fontSize: 13,
  },
  consentText: { marginTop: spacing.sm },
  consentP: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: 8 },
  consentVersion: {
    ...typography.caption, color: colors.textMuted, marginTop: spacing.sm,
  },
});
