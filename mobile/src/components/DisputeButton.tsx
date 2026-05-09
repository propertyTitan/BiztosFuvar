// „Problémám van ezzel a fuvarral" gomb mobilon — modal-szerű felugró
// ablakkal vita-nyitáshoz. Backend POST /disputes-t hív.
//
// Megjelenik: a fuvar/foglalás detail oldal alján, ha a fuvar
// in_progress / delivered / completed státuszban van.

import { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Modal } from 'react-native';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

type Props = {
  jobId?: string;
  bookingId?: string;
  status: string;
  alreadyOpen?: boolean;
};

const ELIGIBLE = ['in_progress', 'delivered', 'completed'];

export default function DisputeButton({ jobId, bookingId, status, alreadyOpen }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!ELIGIBLE.includes(status) || alreadyOpen) return null;

  async function submit() {
    if (description.trim().length < 20) {
      toast.error('Túl rövid', 'Minimum 20 karakter — írd le mi a probléma.');
      return;
    }
    setSubmitting(true);
    try {
      await api.openDispute({
        job_id: jobId,
        booking_id: bookingId,
        description: description.trim(),
      });
      toast.success('Vita megnyitva', 'Egy admin hamarosan ellenőrzi.');
      setOpen(false);
      setDescription('');
    } catch (e: any) {
      toast.error('Nem sikerült', e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Pressable style={styles.openBtn} onPress={() => setOpen(true)}>
        <Text style={styles.openBtnText}>🚨 Problémám van ezzel a fuvarral</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Vita megnyitása</Text>
            <Text style={styles.body}>
              Írd le pontosan, mi a probléma. Egy admin 24 órán belül megvizsgálja és
              felveszi veled a kapcsolatot. A fizetés (escrow) addig befagyasztva.
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Pl. A csomag sérülten érkezett…"
              placeholderTextColor={colors.textMuted}
              multiline
              maxLength={2000}
              style={styles.textarea}
              autoFocus
            />
            <Text style={styles.charCount}>{description.length} / 2000</Text>
            <View style={styles.row}>
              <Pressable
                style={[styles.btn, styles.btnDanger, submitting && { opacity: 0.5 }]}
                onPress={submit}
                disabled={submitting}
              >
                <Text style={styles.btnText}>
                  {submitting ? 'Küldés…' : '🚨 Vita megnyitása'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setOpen(false)}
              >
                <Text style={styles.btnGhostText}>Mégse</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  openBtn: {
    marginTop: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: 'transparent',
    alignSelf: 'flex-start',
  },
  openBtnText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.md,
  },
  dialog: {
    backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.lg,
    width: '100%', maxWidth: 480,
  },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 8 },
  body: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  textarea: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
    padding: 10, fontSize: 14, color: colors.text,
    backgroundColor: colors.surface, minHeight: 100, textAlignVertical: 'top',
  },
  charCount: { fontSize: 11, color: colors.textMuted, marginTop: 4, textAlign: 'right' },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    flex: 1, paddingVertical: 12, borderRadius: radius.sm, alignItems: 'center',
  },
  btnDanger: { backgroundColor: colors.danger },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.text, fontWeight: '600', fontSize: 14 },
});
