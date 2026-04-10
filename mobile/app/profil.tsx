// Profil oldal mobilon — megtekintés + szerkesztés.
// Nincs sofőr vs feladó megkülönböztetés — a jármű adatok opcionálisak.
import { useCallback, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import TruckLoader from '@/components/TruckLoader';
import { colors, spacing, radius } from '@/theme';

export default function ProfilScreen() {
  const toast = useToast();
  const [profile, setProfile] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [bio, setBio] = useState('');

  useFocusEffect(
    useCallback(() => {
      api.getMyProfile().then((p) => {
        setProfile(p);
        setFullName(p.full_name || '');
        setPhone(p.phone || '');
        setVehicleType(p.vehicle_type || '');
        setVehiclePlate(p.vehicle_plate || '');
        setBio(p.bio || '');
      }).catch((e) => Alert.alert('Hiba', e.message));
    }, []),
  );

  async function save() {
    setSaving(true);
    try {
      const updated = await api.updateMyProfile({
        full_name: fullName.trim(),
        phone: phone.trim(),
        vehicle_type: vehicleType.trim(),
        vehicle_plate: vehiclePlate.trim(),
        bio: bio.trim(),
      });
      setProfile(updated);
      setEditing(false);
      toast.success('Profil mentve');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <TruckLoader />;

  const initial = (profile.full_name || '?').charAt(0).toUpperCase();
  const memberSince = new Date(profile.created_at).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
  });

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {/* Avatar + név + rating */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{profile.full_name}</Text>
        <Text style={styles.email}>{profile.email}</Text>
        <View style={styles.badges}>
          {profile.rating_count > 0 ? (
            <View style={styles.ratingBadge}>
              <Text style={styles.ratingText}>
                ⭐ {Number(profile.rating_avg).toFixed(1)} ({profile.rating_count})
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>Még nincs értékelés</Text>
          )}
          <Text style={styles.muted}>Tag {memberSince} óta</Text>
        </View>
      </View>

      {!editing ? (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Személyes adatok</Text>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Név</Text>
                <Text style={styles.fieldValue}>{profile.full_name}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Telefon</Text>
                <Text style={styles.fieldValue}>{profile.phone || '—'}</Text>
              </View>
            </View>
            {profile.bio ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={styles.fieldLabel}>Bemutatkozás</Text>
                <Text style={styles.fieldValue}>{profile.bio}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🚛 Jármű (opcionális)</Text>
            <Text style={[styles.muted, { marginBottom: spacing.sm }]}>
              Ha sofőrként is tevékenykedsz, add meg a járműved.
            </Text>
            <View style={styles.fieldRow}>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Típus</Text>
                <Text style={styles.fieldValue}>{profile.vehicle_type || '—'}</Text>
              </View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Rendszám</Text>
                <Text style={styles.fieldValue}>{profile.vehicle_plate || '—'}</Text>
              </View>
            </View>
          </View>

          <Pressable style={styles.editBtn} onPress={() => setEditing(true)}>
            <Text style={styles.editBtnText}>✏️ Profil szerkesztése</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Személyes adatok</Text>
            <Text style={styles.fieldLabel}>Teljes név</Text>
            <TextInput style={styles.input} value={fullName} onChangeText={setFullName} />
            <Text style={styles.fieldLabel}>Telefon</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+36 30 123 4567" keyboardType="phone-pad" />
            <Text style={styles.fieldLabel}>Bemutatkozás</Text>
            <TextInput style={[styles.input, { minHeight: 70 }]} value={bio} onChangeText={setBio} multiline placeholder="Pár szó magadról…" />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🚛 Jármű (opcionális)</Text>
            <Text style={styles.fieldLabel}>Jármű típusa</Text>
            <TextInput style={styles.input} value={vehicleType} onChangeText={setVehicleType} placeholder="pl. Ford Transit, 3.5t" />
            <Text style={styles.fieldLabel}>Rendszám</Text>
            <TextInput style={styles.input} value={vehiclePlate} onChangeText={setVehiclePlate} placeholder="pl. ABC-123" autoCapitalize="characters" />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Pressable style={[styles.editBtn, { flex: 1, backgroundColor: colors.primary }]} onPress={save} disabled={saving}>
              <Text style={[styles.editBtnText, { color: '#fff' }]}>
                {saving ? 'Mentés…' : '💾 Mentés'}
              </Text>
            </Pressable>
            <Pressable style={[styles.editBtn, { flex: 1 }]} onPress={() => setEditing(false)}>
              <Text style={styles.editBtnText}>Mégse</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  name: { fontSize: 24, fontWeight: '800', color: colors.text },
  email: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  badges: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm, alignItems: 'center' },
  ratingBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  ratingText: { fontSize: 13, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 13 },

  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  fieldRow: { flexDirection: 'row', gap: spacing.md },
  field: { flex: 1 },
  fieldLabel: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 2, marginTop: spacing.sm },
  fieldValue: { fontSize: 15, color: colors.text, fontWeight: '600' },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    backgroundColor: '#fff',
    color: colors.text,
    marginBottom: spacing.sm,
  },

  editBtn: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  editBtnText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
});
