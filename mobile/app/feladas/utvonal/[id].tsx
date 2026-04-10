// Feladó: egy sofőri útvonal részlete + foglalás form mobilon.
// Saját útvonalon nem lehet helyet foglalni — ilyenkor "Saját poszt"
// figyelmeztetés és link a sofőri részletek oldalra.
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, TextInput, Alert,
} from 'react-native';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import AddressAutocomplete from '@/components/AddressAutocomplete';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { PACKAGE_SIZES, classifyPackage, PackageSizeId } from '@/constants';
import { useToast } from '@/components/ToastProvider';
import TruckLoader from '@/components/TruckLoader';
import { colors, spacing, radius } from '@/theme';

export default function FeladoUtvonalReszletekMobil() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [route, setRoute] = useState<any>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => setMeId(u?.id || null));
  }, []);

  const [length, setLength] = useState('');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');

  const [pickupAddr, setPickupAddr] = useState('');
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [pickupConfirmed, setPickupConfirmed] = useState(false);

  const [dropoffAddr, setDropoffAddr] = useState('');
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);
  const [dropoffConfirmed, setDropoffConfirmed] = useState(false);

  const [notes, setNotes] = useState('');

  useEffect(() => {
    api.getCarrierRoute(id!).then(setRoute).catch((e) => Alert.alert('Hiba', e.message));
  }, [id]);

  const classification = useMemo<PackageSizeId | null>(() => {
    const L = Number(length), W = Number(width), H = Number(height), kg = Number(weight);
    if (!L || !W || !H || !kg) return null;
    return classifyPackage(L, W, H, kg);
  }, [length, width, height, weight]);

  const priceForSelected = route?.prices?.find((p: any) => p.size === classification);
  const sofőrVisziE = !!classification && !!priceForSelected;

  const canSubmit =
    sofőrVisziE &&
    pickupConfirmed &&
    dropoffConfirmed &&
    Number(length) > 0 &&
    Number(width) > 0 &&
    Number(height) > 0 &&
    Number(weight) > 0;

  async function submit() {
    if (!canSubmit || !route) return;
    setSubmitting(true);
    try {
      await api.createRouteBooking(route.id, {
        length_cm: Number(length),
        width_cm: Number(width),
        height_cm: Number(height),
        weight_kg: Number(weight),
        pickup_address: pickupAddr,
        pickup_lat: pickupLat!,
        pickup_lng: pickupLng!,
        dropoff_address: dropoffAddr,
        dropoff_lat: dropoffLat!,
        dropoff_lng: dropoffLng!,
        notes: notes || undefined,
      });
      toast.success('Foglalás elküldve', 'A sofőrnek meg kell erősítenie');
      router.replace('/feladas/foglalasaim');
    } catch (err: any) {
      toast.error('Hiba', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!route) return <TruckLoader />;

  const isMine = meId && route.carrier_id === meId;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{route.title}</Text>
      <Text style={styles.muted}>
        🗓 {new Date(route.departure_at).toLocaleString('hu-HU')}
      </Text>

      {/* Saját poszt figyelmeztetés */}
      {isMine && (
        <View style={styles.ownPostBox}>
          <Text style={styles.ownPostTitle}>📣 Ez a te saját útvonalad</Text>
          <Text style={styles.ownPostBody}>
            A saját hirdetésedre nem foglalhatsz helyet. Nyisd meg a sofőri
            nézetet a foglalások kezeléséhez és a szerkesztéshez.
          </Text>
          <Link
            href={{ pathname: '/utvonal/[id]', params: { id: id! } }}
            asChild
          >
            <Pressable style={styles.cta}>
              <Text style={styles.ctaText}>Sofőri nézet →</Text>
            </Pressable>
          </Link>
        </View>
      )}

      {/* Útvonal */}
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
        {route.vehicle_description ? (
          <Text style={[styles.row, { marginTop: 8 }]}>🚛 {route.vehicle_description}</Text>
        ) : null}
        {route.description ? (
          <Text style={styles.description}>{route.description}</Text>
        ) : null}
      </View>

      {/* Árak */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Elérhető méretek</Text>
        <View style={styles.priceRow}>
          {PACKAGE_SIZES.map((ps) => {
            const price = route.prices.find((p: any) => p.size === ps.id);
            const active = !!price;
            return (
              <View
                key={ps.id}
                style={[styles.priceCard, !active && { opacity: 0.4, backgroundColor: '#f1f5f9' }]}
              >
                <Text style={styles.priceCardTitle}>{ps.id} — {ps.label_hu}</Text>
                <Text style={styles.priceCardDesc}>{ps.description_hu}</Text>
                <Text style={[styles.priceCardPrice, !active && { color: colors.textMuted }]}>
                  {active ? `${price.price_huf.toLocaleString('hu-HU')} Ft` : 'nem vállalja'}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* Foglalás form – saját posztnál teljesen elrejtjük, hogy el se
          lehessen indítani. A backend is 403-mal utasítja el. */}
      {!isMine && (
      <>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Csomagod méretei</Text>
        <View style={styles.grid2}>
          <View style={styles.col}>
            <Text style={styles.label}>Hossz (cm)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={length}
              onChangeText={(v) => setLength(v.replace(/[^0-9]/g, ''))}
              placeholder="30"
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Szél. (cm)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={width}
              onChangeText={(v) => setWidth(v.replace(/[^0-9]/g, ''))}
              placeholder="20"
            />
          </View>
        </View>
        <View style={styles.grid2}>
          <View style={styles.col}>
            <Text style={styles.label}>Mag. (cm)</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={height}
              onChangeText={(v) => setHeight(v.replace(/[^0-9]/g, ''))}
              placeholder="15"
            />
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Súly (kg)</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={weight}
              onChangeText={(v) => setWeight(v.replace(/[^0-9.,]/g, '').replace(',', '.'))}
              placeholder="3.5"
            />
          </View>
        </View>

        {classification && (
          <View
            style={[
              styles.classification,
              { backgroundColor: sofőrVisziE ? '#dcfce7' : '#fee2e2' },
            ]}
          >
            <Text style={{ fontWeight: '700', color: colors.text }}>
              Besorolás: {classification}
              {sofőrVisziE && priceForSelected
                ? ` — ${priceForSelected.price_huf.toLocaleString('hu-HU')} Ft`
                : ' — sajnos ezt a sofőr nem vállalja'}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Felvétel helye</Text>
        <AddressAutocomplete
          label=""
          value={pickupAddr}
          onPick={(addr, lat, lng) => {
            setPickupAddr(addr);
            setPickupLat(lat);
            setPickupLng(lng);
            setPickupConfirmed(true);
          }}
          onTextChange={(text) => {
            setPickupAddr(text);
            setPickupConfirmed(false);
          }}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Lerakodás helye</Text>
        <AddressAutocomplete
          label=""
          value={dropoffAddr}
          onPick={(addr, lat, lng) => {
            setDropoffAddr(addr);
            setDropoffLat(lat);
            setDropoffLng(lng);
            setDropoffConfirmed(true);
          }}
          onTextChange={(text) => {
            setDropoffAddr(text);
            setDropoffConfirmed(false);
          }}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Megjegyzés (opcionális)</Text>
        <TextInput
          style={[styles.input, { minHeight: 60 }]}
          multiline
          value={notes}
          onChangeText={setNotes}
          placeholder="pl. törékeny"
        />
      </View>

      <Pressable
        style={[styles.cta, !canSubmit && styles.ctaDisabled]}
        disabled={!canSubmit || submitting}
        onPress={submit}
      >
        <Text style={styles.ctaText}>
          {submitting
            ? 'Foglalás…'
            : `Helyet foglalok${priceForSelected ? ` — ${priceForSelected.price_huf.toLocaleString('hu-HU')} Ft` : ''}`}
        </Text>
      </Pressable>
      </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  muted: { color: colors.textMuted, fontSize: 13 },
  row: { color: colors.text, marginTop: 2 },
  description: { color: colors.text, marginTop: 8, lineHeight: 20 },

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

  priceRow: { gap: 8 },
  priceCard: {
    backgroundColor: '#eff6ff',
    padding: spacing.sm,
    borderRadius: radius.md,
    marginBottom: 8,
  },
  priceCardTitle: { fontWeight: '700', color: colors.text, fontSize: 14 },
  priceCardDesc: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  priceCardPrice: { color: colors.primary, fontWeight: '700', marginTop: 4 },

  grid2: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  col: { flex: 1 },
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
  classification: {
    padding: spacing.sm,
    borderRadius: radius.md,
    marginTop: spacing.sm,
  },

  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  ctaDisabled: { backgroundColor: colors.textMuted, opacity: 0.6 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  ownPostBox: {
    backgroundColor: '#fefce8',
    borderColor: '#facc15',
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  ownPostTitle: { fontSize: 16, fontWeight: '800', color: '#713f12', marginBottom: spacing.xs },
  ownPostBody: { color: '#713f12', fontSize: 14, marginBottom: spacing.sm, lineHeight: 20 },
});
