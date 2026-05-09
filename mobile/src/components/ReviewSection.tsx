// Review szekció mobilon — feladó és sofőr fuvar-detail oldalához.
//
// 1) Lekéri a meglévő értékeléseket
// 2) Ha még nem értékelt és a fuvar lezárt, megjelenít egy űrlapot
//    csillagokkal + szöveggel
// 3) Beküldés után frissít

import { useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

type Props = {
  jobId?: string;
  bookingId?: string;
  status: string;
};

export default function ReviewSection({ jobId, bookingId, status }: Props) {
  const toast = useToast();
  const [reviews, setReviews] = useState<any[]>([]);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [meId, setMeId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => setMeId(u?.id || null));
  }, []);

  useEffect(() => {
    if (!jobId && !bookingId) return;
    api.getReviews({ job_id: jobId, booking_id: bookingId })
      .then(setReviews)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [jobId, bookingId]);

  const myReview = meId ? reviews.find((r: any) => r.reviewer_id === meId) : null;
  const canReview =
    !!meId &&
    ['delivered', 'completed'].includes(status) &&
    !myReview;

  async function submit() {
    if (!stars) return;
    setSubmitting(true);
    try {
      const r = await api.submitReview({
        job_id: jobId,
        booking_id: bookingId,
        stars,
        comment: comment.trim() || undefined,
      });
      setReviews((prev) => [{ ...r, reviewer_id: meId, stars, rating: stars, comment }, ...prev]);
      setComment('');
      setStars(0);
      toast.success('Értékelés rögzítve', 'Köszönjük!');
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!loaded) return null;
  if (reviews.length === 0 && !canReview) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>⭐ Értékelések</Text>

      {canReview && (
        <View style={styles.form}>
          <Text style={styles.label}>Hogyan értékelnéd a másik felet?</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable key={n} onPress={() => setStars(n)} hitSlop={4}>
                <Text style={[styles.star, { color: n <= stars ? '#fbbf24' : '#cbd5e1' }]}>
                  ★
                </Text>
              </Pressable>
            ))}
            {stars > 0 && (
              <Text style={styles.starsLabel}>
                {stars === 1 ? 'Gyenge' : stars === 2 ? 'Elfogadható' : stars === 3 ? 'Átlagos' : stars === 4 ? 'Jó' : 'Kiváló'}
              </Text>
            )}
          </View>
          <TextInput
            value={comment}
            onChangeText={setComment}
            placeholder="Szöveges visszajelzés (opcionális)…"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={500}
            style={styles.textarea}
          />
          <Pressable
            onPress={submit}
            disabled={!stars || submitting}
            style={[styles.btn, (!stars || submitting) && { opacity: 0.5 }]}
          >
            <Text style={styles.btnText}>
              {submitting ? 'Küldés…' : 'Értékelés beküldése'}
            </Text>
          </Pressable>
        </View>
      )}

      {reviews.length === 0 ? (
        <Text style={styles.muted}>Még nincs értékelés.</Text>
      ) : (
        reviews.map((r: any) => (
          <View key={r.id} style={styles.reviewItem}>
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewStars}>
                {'★'.repeat(r.stars || r.rating || 0)}
                <Text style={{ color: '#cbd5e1' }}>{'★'.repeat(5 - (r.stars || r.rating || 0))}</Text>
              </Text>
              <Text style={styles.reviewerName}>{r.reviewer_name || '—'}</Text>
              <Text style={styles.reviewDate}>
                {new Date(r.created_at).toLocaleDateString('hu-HU')}
              </Text>
            </View>
            {r.comment ? <Text style={styles.reviewComment}>{r.comment}</Text> : null}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  form: {
    paddingBottom: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8 },
  starsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.md },
  star: { fontSize: 32, paddingHorizontal: 2 },
  starsLabel: { marginLeft: 8, color: colors.textMuted, fontSize: 13 },
  textarea: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: 10, fontSize: 14, color: colors.text,
    backgroundColor: colors.background, minHeight: 70, marginBottom: spacing.md,
    textAlignVertical: 'top',
  },
  btn: {
    backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radius.sm,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  muted: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
  reviewItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reviewStars: { color: '#fbbf24', fontSize: 14 },
  reviewerName: { fontWeight: '700', fontSize: 13, color: colors.text },
  reviewDate: { color: colors.textMuted, fontSize: 11 },
  reviewComment: { fontSize: 13, color: colors.text, marginTop: 6, lineHeight: 18 },
});
