// Egyszerű bejelentkezés a backend /auth/login végpontjához.
// Login után role-alapú redirect: feladó → saját fuvarok, sofőr → elérhető fuvarok.
//
// A mezők üresen indulnak. A screen a router.replace miatt tényleg
// unmount-ol logout↔login között, tehát a `useState('')` mindig friss
// állapotot hoz — nincs szükség külön `useFocusEffect` reset-re.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/api';
import { setCurrentUser, homeForRole, Role } from '@/auth';
import { colors, spacing, radius } from '@/theme';

export default function Bejelentkezes() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    // Whitespace-re érzékeny backend-ek miatt trim-elünk. A jelszót
    // direkt NEM trim-eljük, mert abban lehet szándékos space.
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      Alert.alert('Hiányzó adat', 'Add meg az email címet és a jelszót.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.login(cleanEmail, password);
      const role = (res.user.role as Role) || 'shipper';
      await setCurrentUser(
        {
          id: res.user.id,
          email: res.user.email,
          role,
          full_name: (res.user as any).full_name,
        },
        res.token,
      );
      router.replace(homeForRole(role) as any);
    } catch (err: any) {
      Alert.alert('Sikertelen bejelentkezés', err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Text style={styles.label}>Jelszó</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={styles.cta} disabled={loading} onPress={onSubmit}>
        <Text style={styles.ctaText}>{loading ? 'Belépés...' : 'Belépés'}</Text>
      </Pressable>
      <Text style={styles.hint}>
        Tipp: minden seed felhasználó jelszava: Jelszo123!
        {'\n'}Feladó: kovacs.peter@example.hu
        {'\n'}Sofőr: szabo.janos@example.hu
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  label: { color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.md, fontSize: 13 },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { color: colors.textMuted, marginTop: spacing.lg, fontSize: 12, textAlign: 'center' },
});
