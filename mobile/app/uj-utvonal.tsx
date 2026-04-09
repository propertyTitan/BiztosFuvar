// Sofőr: új / szerkesztés útvonal hirdetés mobil form.
// - Új mód: route /uj-utvonal
// - Szerkesztés: /uj-utvonal?edit=<id> → betölti a meglévő útvonalat,
//   és a mentéskor PATCH-et hív POST helyett.
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { api } from '@/api';
import { PACKAGE_SIZES, PackageSizeId } from '@/constants';
import { colors, spacing, radius } from '@/theme';

type Tag = {
  name: string;
  formatted_address?: string;
  lat: number;
  lng: number;
  order: number;
};

type SizeRow = { enabled: boolean; price: string };

export default function UjUtvonalMobil() {
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEdit = !!edit;

  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vehicle, setVehicle] = useState('');

  const [tags, setTags] = useState<Tag[]>([]);
  const [newCityText, setNewCityText] = useState('');

  // Egyszerű dátum + idő bevitel: YYYY-MM-DD + HH:MM
  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [timeStr, setTimeStr] = useState('08:00');

  const [sizes, setSizes] = useState<Record<PackageSizeId, SizeRow>>({
    S: { enabled: false, price: '' },
    M: { enabled: true, price: '' },
    L: { enabled: true, price: '' },
    XL: { enabled: false, price: '' },
  });

  // Szerkesztés módban betöltjük a meglévő útvonalat
  useEffect(() => {
    if (!edit) return;
    (async () => {
      try {
        const r = await api.getCarrierRoute(edit);
        setTitle(r.title || '');
        setDescription(r.description || '');
        setVehicle(r.vehicle_description || '');
        setTags((r.waypoints || []).map((w: any, i: number) => ({
          name: w.name,
          formatted_address: w.formatted_address,
          lat: w.lat,
          lng: w.lng,
          order: i,
        })));
        const d = new Date(r.departure_at);
        const pad = (n: number) => String(n).padStart(2, '0');
        setDateStr(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
        setTimeStr(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
        const nextSizes: Record<PackageSizeId, SizeRow> = {
          S: { enabled: false, price: '' },
          M: { enabled: false, price: '' },
          L: { enabled: false, price: '' },
          XL: { enabled: false, price: '' },
        };
        for (const p of r.prices || []) {
          nextSizes[p.size as PackageSizeId] = { enabled: true, price: String(p.price_huf) };
        }
        setSizes(nextSizes);
      } catch (err: any) {
        Alert.alert('Hiba', err.message);
      }
    })();
  }, [edit]);

  function addTag(addr: string, lat: number, lng: number) {
    setTags((prev) => [
      ...prev,
      { name: addr.split(',')[0], formatted_address: addr, lat, lng, order: prev.length },
    ]);
    setNewCityText('');
  }

  function removeTag(i: number) {
    setTags((prev) => prev.filter((_, idx) => idx !== i).map((t, idx) => ({ ...t, order: idx })));
  }

  function toggleSize(id: PackageSizeId) {
    setSizes((prev) => ({ ...prev, [id]: { ...prev[id], enabled: !prev[id].enabled } }));
  }
  function setSizePrice(id: PackageSizeId, price: string) {
    setSizes((prev) => ({
      ...prev,
      [id]: { ...prev[id], price: price.replace(/[^0-9]/g, '') },
    }));
  }

  const canSubmit =
    title.trim().length > 0 &&
    tags.length >= 2 &&
    dateStr.length === 10 &&
    /^\d{1,2}:\d{2}$/.test(timeStr) &&
    Object.values(sizes).some((s) => s.enabled && Number(s.price) > 0);

  async function submit(publishNow: boolean) {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const prices = Object.entries(sizes)
        .filter(([, s]) => s.enabled && Number(s.price) > 0)
        .map(([size, s]) => ({ size, price_huf: Number(s.price) }));

      // YYYY-MM-DDTHH:MM — ISO lokális idő
      const departureAt = new Date(`${dateStr}T${timeStr.padStart(5, '0')}:00`).toISOString();

      const body = {
        title,
        description: description || undefined,
        departure_at: departureAt,
        waypoints: tags,
        vehicle_description: vehicle || undefined,
        prices,
        status: publishNow ? 'open' : 'draft',
      };

      if (isEdit && edit) {
        await api.updateCarrierRoute(edit, body);
      } else {
        await api.createCarrierRoute(body);
      }
      router.replace('/utvonalaim');
    } catch (err: any) {
      Alert.alert('Hiba', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.h2}>Útvonal</Text>

      {tags.length > 0 && (
        <View style={styles.tagRow}>
          {tags.map((t, i) => (
            <View
              key={`${t.lat}-${i}`}
              style={[
                styles.tag,
                i === 0 && { backgroundColor: '#dcfce7' },
                i === tags.length - 1 && { backgroundColor: '#fee2e2' },
              ]}
            >
              <Text style={styles.tagText}>
                <Text style={styles.tagIndex}>
                  {i === 0 ? 'INDULÁS · ' : i === tags.length - 1 ? 'CÉL · ' : `${i}. · `}
                </Text>
                {t.name}
              </Text>
              <Pressable onPress={() => removeTag(i)} style={styles.tagClose}>
                <Text style={styles.tagCloseText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <AddressAutocomplete
        label=""
        value={newCityText}
        onPick={addTag}
        onTextChange={setNewCityText}
        placeholder={
          tags.length === 0
            ? 'Kezdd el beírni a kiindulási várost'
            : 'Adj hozzá egy újabb várost vagy célt'
        }
      />

      <Text style={styles.h2}>Megnevezés</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={
          tags.length >= 2
            ? `${tags[0].name} → ${tags[tags.length - 1].name}`
            : 'pl. Szeged → Budapest reggel'
        }
      />

      <Text style={styles.h2}>Indulás időpontja</Text>
      <View style={styles.grid2}>
        <View style={styles.col}>
          <Text style={styles.label}>Dátum (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={dateStr}
            onChangeText={setDateStr}
            placeholder="2026-04-10"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.col}>
          <Text style={styles.label}>Idő (HH:MM)</Text>
          <TextInput
            style={styles.input}
            value={timeStr}
            onChangeText={setTimeStr}
            placeholder="08:00"
            autoCapitalize="none"
          />
        </View>
      </View>

      <Text style={styles.h2}>Jármű (opcionális)</Text>
      <TextInput
        style={styles.input}
        value={vehicle}
        onChangeText={setVehicle}
        placeholder="pl. Kisteherautó, 1 m³ szabad hely"
      />

      <Text style={styles.h2}>Megjegyzés</Text>
      <TextInput
        style={[styles.input, { minHeight: 70 }]}
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder="pl. Reggeli indulás 7-8 között. Nem törékeny."
      />

      <Text style={styles.h2}>Csomag kategóriák és árak</Text>
      <Text style={styles.muted}>
        Pipáld be, amit vinnél, és add meg a saját árad.
      </Text>

      {PACKAGE_SIZES.map((ps) => {
        const row = sizes[ps.id];
        return (
          <View
            key={ps.id}
            style={[
              styles.sizeCard,
              row.enabled && { backgroundColor: '#eff6ff', borderColor: colors.primary },
            ]}
          >
            <Pressable
              onPress={() => toggleSize(ps.id)}
              style={[styles.checkbox, row.enabled && styles.checkboxOn]}
            >
              {row.enabled && <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text>}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.sizeTitle}>{ps.id} — {ps.label_hu}</Text>
              <Text style={styles.muted}>{ps.description_hu}</Text>
            </View>
            <TextInput
              style={[styles.input, styles.priceInput, !row.enabled && { opacity: 0.4 }]}
              keyboardType="number-pad"
              value={row.price}
              onChangeText={(v) => setSizePrice(ps.id, v)}
              placeholder="Ft"
              editable={row.enabled}
            />
          </View>
        );
      })}

      <Pressable
        style={[styles.cta, !canSubmit && styles.ctaDisabled]}
        disabled={!canSubmit || submitting}
        onPress={() => submit(true)}
      >
        <Text style={styles.ctaText}>
          {submitting ? 'Publikálás…' : 'Publikálás most'}
        </Text>
      </Pressable>
      <Pressable
        style={[styles.cta, styles.ctaSecondary, !canSubmit && styles.ctaDisabled]}
        disabled={!canSubmit || submitting}
        onPress={() => submit(false)}
      >
        <Text style={[styles.ctaText, { color: colors.primary }]}>Mentés piszkozatként</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  h2: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  muted: { color: colors.textMuted, fontSize: 13 },
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
  grid2: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.sm },
  tag: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tagText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  tagIndex: { fontSize: 10, opacity: 0.7, fontWeight: '400' },
  tagClose: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagCloseText: { color: '#fff', fontWeight: '700', fontSize: 12, lineHeight: 14 },

  sizeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  sizeTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary },
  priceInput: { width: 90, textAlign: 'right' },

  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  ctaSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  ctaDisabled: { backgroundColor: colors.textMuted, opacity: 0.6 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
