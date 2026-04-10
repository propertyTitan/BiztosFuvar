// Feladói új fuvar feladás mobilról.
// - AddressAutocomplete pickup + dropoff címekhez (Google Places).
// - Kötelező: cím (választott), méretek (cm), súly (kg), ár (Ft).
// - Térfogat automatikusan számolódik a méretekből.
// - Fotó feltöltés: a feladó a csomagról fényképet készíthet vagy
//   galériából választhat (expo-image-picker). A fotókat a fuvar
//   létrehozása UTÁN töltjük fel `api.uploadPhoto`-val.
import { useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

type FormState = {
  title: string;
  description: string;

  pickup_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_confirmed: boolean;

  dropoff_address: string;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_confirmed: boolean;

  weight_kg: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
  suggested_price_huf: string;
};

const initial: FormState = {
  title: '',
  description: '',
  pickup_address: '',
  pickup_lat: null,
  pickup_lng: null,
  pickup_confirmed: false,
  dropoff_address: '',
  dropoff_lat: null,
  dropoff_lng: null,
  dropoff_confirmed: false,
  weight_kg: '',
  length_cm: '',
  width_cm: '',
  height_cm: '',
  suggested_price_huf: '',
};

export default function UjFuvarFeladas() {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState<ImagePicker.ImagePickerAsset[]>([]);

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Engedély szükséges', 'A fotó feltöltéshez a galéria-hozzáférés kell.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: 5,
    });
    if (!result.canceled && result.assets) {
      setPhotos((prev) => [...prev, ...result.assets].slice(0, 5));
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Engedély szükséges', 'A fotó készítéshez a kamera-hozzáférés kell.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setPhotos((prev) => [...prev, result.assets[0]].slice(0, 5));
    }
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function up<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  const volumeM3 = useMemo(() => {
    const L = Number(form.length_cm),
      W = Number(form.width_cm),
      H = Number(form.height_cm);
    if (!L || !W || !H) return null;
    return +((L * W * H) / 1_000_000).toFixed(3);
  }, [form.length_cm, form.width_cm, form.height_cm]);

  const canSubmit =
    !!form.title.trim() &&
    form.pickup_confirmed &&
    form.dropoff_confirmed &&
    !!form.length_cm &&
    !!form.width_cm &&
    !!form.height_cm &&
    !!form.weight_kg &&
    !!form.suggested_price_huf;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const job = await api.createJob({
        title: form.title,
        description: form.description || undefined,
        pickup_address: form.pickup_address,
        pickup_lat: form.pickup_lat!,
        pickup_lng: form.pickup_lng!,
        dropoff_address: form.dropoff_address,
        dropoff_lat: form.dropoff_lat!,
        dropoff_lng: form.dropoff_lng!,
        weight_kg: Number(form.weight_kg),
        length_cm: Number(form.length_cm),
        width_cm: Number(form.width_cm),
        height_cm: Number(form.height_cm),
        suggested_price_huf: Number(form.suggested_price_huf),
      });
      // Fotók feltöltése (fire-and-forget: a fuvar már létrejött, a fotók
      // háttérben mennek fel — ha valamelyik elhasal, a fuvar akkor is él)
      if (photos.length > 0) {
        toast.info('Fotók feltöltése…', `${photos.length} fotó`);
        for (const photo of photos) {
          try {
            await api.uploadPhoto({
              jobId: job.id,
              kind: 'listing',
              fileUri: photo.uri,
              fileName: photo.fileName || 'photo.jpg',
              mimeType: photo.mimeType || 'image/jpeg',
            });
          } catch (e: any) {
            console.warn('[foto] upload hiba:', e.message);
          }
        }
      }
      toast.success('Fuvar feladva', 'A sofőrök hamarosan licitálnak rá');
      router.replace({ pathname: '/feladas/[id]', params: { id: job.id } });
    } catch (err: any) {
      toast.error('Hiba a fuvar feladásakor', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.h2}>Megnevezés</Text>
      <TextInput
        style={styles.input}
        value={form.title}
        onChangeText={(v) => up('title', v)}
        placeholder="pl. Költöztetés Budapest → Debrecen"
      />

      <Text style={styles.h2}>Részletes leírás</Text>
      <TextInput
        style={[styles.input, { minHeight: 70 }]}
        value={form.description}
        onChangeText={(v) => up('description', v)}
        placeholder="Mit viszünk? Lift van? Kézi cipelés?"
        multiline
      />

      {/* Fotók a csomagról */}
      <Text style={styles.h2}>Fotók a csomagról (opcionális)</Text>
      <Text style={styles.muted}>
        Adj hozzá akár 5 fotót, hogy a sofőr lássa mit visz. Galériából választhatsz
        vagy most készíthetsz.
      </Text>
      <View style={styles.photoRow}>
        {photos.map((p, i) => (
          <View key={i} style={styles.photoThumb}>
            <Image source={{ uri: p.uri }} style={styles.photoImg} />
            <Pressable
              style={styles.photoRemove}
              onPress={() => removePhoto(i)}
              hitSlop={8}
            >
              <Text style={styles.photoRemoveText}>×</Text>
            </Pressable>
          </View>
        ))}
        {photos.length < 5 && (
          <>
            <Pressable style={styles.photoAdd} onPress={pickPhoto}>
              <Text style={{ fontSize: 24 }}>🖼️</Text>
              <Text style={styles.photoAddText}>Galéria</Text>
            </Pressable>
            <Pressable style={styles.photoAdd} onPress={takePhoto}>
              <Text style={{ fontSize: 24 }}>📸</Text>
              <Text style={styles.photoAddText}>Kamera</Text>
            </Pressable>
          </>
        )}
      </View>

      <Text style={styles.h2}>Felvétel helye</Text>
      <AddressAutocomplete
        label="Cím"
        value={form.pickup_address}
        onPick={(addr, lat, lng) =>
          setForm((f) => ({
            ...f,
            pickup_address: addr,
            pickup_lat: lat,
            pickup_lng: lng,
            pickup_confirmed: true,
          }))
        }
        onTextChange={(text) =>
          setForm((f) => ({ ...f, pickup_address: text, pickup_confirmed: false }))
        }
      />
      {form.pickup_confirmed && form.pickup_lat != null && (
        <Text style={styles.hint}>
          ✓ Koordináta: {form.pickup_lat.toFixed(5)}, {form.pickup_lng!.toFixed(5)}
        </Text>
      )}
      {!form.pickup_confirmed && form.pickup_address && (
        <Text style={styles.warn}>⚠ Válassz egy címet a listából.</Text>
      )}

      <Text style={styles.h2}>Lerakodás helye</Text>
      <AddressAutocomplete
        label="Cím"
        value={form.dropoff_address}
        onPick={(addr, lat, lng) =>
          setForm((f) => ({
            ...f,
            dropoff_address: addr,
            dropoff_lat: lat,
            dropoff_lng: lng,
            dropoff_confirmed: true,
          }))
        }
        onTextChange={(text) =>
          setForm((f) => ({ ...f, dropoff_address: text, dropoff_confirmed: false }))
        }
      />
      {form.dropoff_confirmed && form.dropoff_lat != null && (
        <Text style={styles.hint}>
          ✓ Koordináta: {form.dropoff_lat.toFixed(5)}, {form.dropoff_lng!.toFixed(5)}
        </Text>
      )}
      {!form.dropoff_confirmed && form.dropoff_address && (
        <Text style={styles.warn}>⚠ Válassz egy címet a listából.</Text>
      )}

      <Text style={styles.h2}>Csomag adatai</Text>
      <Text style={styles.muted}>
        Kötelező – a sofőr ezek alapján tudja, belefér-e a járművébe.
      </Text>
      <View style={styles.grid2}>
        <View style={styles.col}>
          <Text style={styles.label}>Hossz (cm)</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={form.length_cm}
            onChangeText={(v) => up('length_cm', v.replace(/[^0-9]/g, ''))}
            placeholder="120"
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Szél. (cm)</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={form.width_cm}
            onChangeText={(v) => up('width_cm', v.replace(/[^0-9]/g, ''))}
            placeholder="80"
          />
        </View>
      </View>
      <View style={styles.grid2}>
        <View style={styles.col}>
          <Text style={styles.label}>Mag. (cm)</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={form.height_cm}
            onChangeText={(v) => up('height_cm', v.replace(/[^0-9]/g, ''))}
            placeholder="100"
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Súly (kg)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={form.weight_kg}
            onChangeText={(v) => up('weight_kg', v.replace(/[^0-9.,]/g, '').replace(',', '.'))}
            placeholder="350"
          />
        </View>
      </View>
      {volumeM3 != null && (
        <Text style={styles.hint}>Számolt térfogat: {volumeM3} m³</Text>
      )}

      <Text style={styles.h2}>Javasolt fuvardíj</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={form.suggested_price_huf}
        onChangeText={(v) => up('suggested_price_huf', v.replace(/[^0-9]/g, ''))}
        placeholder="pl. 65000 Ft"
      />

      <Pressable
        style={[styles.cta, !canSubmit && styles.ctaDisabled]}
        disabled={!canSubmit || submitting}
        onPress={submit}
      >
        <Text style={styles.ctaText}>
          {submitting ? 'Feladás…' : 'Fuvar feladása'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  h2: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  muted: { color: colors.textMuted, fontSize: 13, marginBottom: spacing.sm },
  label: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    backgroundColor: '#fff',
    color: colors.text,
  },
  grid2: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  col: { flex: 1 },
  hint: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  warn: { color: colors.warning, fontSize: 12, marginTop: 4 },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  ctaDisabled: { backgroundColor: colors.textMuted, opacity: 0.6 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  photoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoRemoveText: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  photoAdd: {
    width: 80,
    height: 80,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  photoAddText: { color: colors.textMuted, fontSize: 10, marginTop: 2 },
});
