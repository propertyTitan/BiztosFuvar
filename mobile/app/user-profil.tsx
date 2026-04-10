// Publikus felhasználói profil mobilon — statisztikák, értékelések, jármű.
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { api } from '@/api';
import TruckLoader from '@/components/TruckLoader';
import { colors, spacing, radius } from '@/theme';

export default function UserProfil() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    api.getUserProfile(id!).then(setProfile).catch(() => {});
  }, [id]);

  if (!profile) return <TruckLoader />;

  const initial = (profile.full_name || '?').charAt(0).toUpperCase();
  const memberSince = new Date(profile.created_at).toLocaleDateString('hu-HU', {
    year: 'numeric', month: 'long',
  });
  const totalDeliveries = (profile.completed_jobs || 0) + (profile.completed_route_deliveries || 0);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Fejléc */}
      <View style={styles.header}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
        ) : (
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        )}
        <Text style={styles.name}>{profile.full_name}</Text>
        <Text style={styles.muted}>Tag {memberSince} óta</Text>
      </View>

      {/* Stat kártyák */}
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: '#dcfce7' }]}>
          <Text style={styles.statNum}>{totalDeliveries}</Text>
          <Text style={styles.statLabel}>Sikeres fuvar</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#fef3c7' }]}>
          <Text style={styles.statNum}>
            {profile.rating_count > 0 ? Number(profile.rating_avg).toFixed(1) : '—'}
          </Text>
          <Text style={styles.statLabel}>Értékelés</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: '#dbeafe' }]}>
          <Text style={styles.statNum}>{profile.rating_count || 0}</Text>
          <Text style={styles.statLabel}>Vélemény</Text>
        </View>
      </View>

      {/* Bio */}
      {profile.bio ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bemutatkozás</Text>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      ) : null}

      {/* Jármű */}
      {(profile.vehicle_type || profile.vehicle_plate) ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>🚛 Jármű</Text>
          <Text style={styles.fieldValue}>
            {[profile.vehicle_type, profile.vehicle_plate].filter(Boolean).join(' · ')}
          </Text>
        </View>
      ) : null}

      {/* Értékelések */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>⭐ Értékelések</Text>
        {(!profile.recent_reviews || profile.recent_reviews.length === 0) ? (
          <Text style={styles.muted}>Még nincs értékelés.</Text>
        ) : (
          profile.recent_reviews.map((r: any, i: number) => (
            <View key={i} style={styles.reviewRow}>
              <Text style={{ color: '#f59e0b', fontSize: 13 }}>
                {'★'.repeat(r.stars || 0)}{'☆'.repeat(5 - (r.stars || 0))}
              </Text>
              <Text style={styles.reviewerName}>{r.reviewer_name}</Text>
              {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg },
  header: { alignItems: 'center', marginBottom: spacing.lg },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: {
    width: 80, height: 80, borderRadius: 40,
    borderWidth: 3, borderColor: colors.primary,
  },
  avatarText: { color: '#fff', fontSize: 30, fontWeight: '800' },
  name: { fontSize: 24, fontWeight: '800', color: colors.text, marginTop: spacing.sm },
  muted: { color: colors.textMuted, fontSize: 13 },

  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flex: 1, borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center',
  },
  statNum: { fontSize: 24, fontWeight: '900', color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  section: {
    backgroundColor: colors.surface, padding: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  bioText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  fieldValue: { color: colors.text, fontSize: 15, fontWeight: '600' },

  reviewRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  reviewerName: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2 },
  reviewComment: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
