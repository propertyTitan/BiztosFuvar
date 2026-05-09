// Email-megerősítési banner mobilon. A profil oldal és a hub tetején
// jelenik meg, ha a user email_verified=false.
import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { api } from '@/api';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

export default function EmailVerifyBanner() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getMyProfile()
      .then((me: any) => {
        if (!cancelled && me && me.email_verified === false) {
          setShow(true);
          setEmail(me.email);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function resend() {
    setResending(true);
    try {
      await api.resendVerification();
      setDone(true);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setResending(false);
    }
  }

  if (!show || hidden) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.title}>📧 Email megerősítése</Text>
      <Text style={styles.text}>
        Az email címed (<Text style={{ fontWeight: '700' }}>{email}</Text>) még nincs megerősítve.
      </Text>
      <View style={styles.row}>
        {done ? (
          <Text style={styles.doneText}>✓ Új linket küldtünk — nézd meg a postaládád + spam mappát.</Text>
        ) : (
          <Pressable onPress={resend} disabled={resending} style={styles.btn}>
            <Text style={styles.btnText}>
              {resending ? 'Küldés…' : 'Küldj egy új linket'}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={() => setHidden(true)} style={styles.dismiss} hitSlop={8}>
          <Text style={{ color: '#78350f', fontSize: 18 }}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: radius.md,
    padding: spacing.md,
    margin: spacing.md,
  },
  title: { fontSize: 14, fontWeight: '800', color: '#78350f', marginBottom: 4 },
  text: { fontSize: 13, color: '#78350f', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, gap: spacing.sm },
  btn: {
    flex: 1,
    backgroundColor: '#f59e0b',
    paddingVertical: 8,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  doneText: { flex: 1, fontSize: 12, color: '#78350f', fontStyle: 'italic' },
  dismiss: { padding: 4 },
});
