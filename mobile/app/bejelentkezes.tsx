// Egyszerű bejelentkezés a backend /auth/login végpontjához.
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

export default function Bejelentkezes() {
  const router = useRouter();
  const [email, setEmail] = useState('szabo.janos@example.hu');
  const [password, setPassword] = useState('Jelszo123!');
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setLoading(true);
    try {
      const res = await api.login(email, password);
      await AsyncStorage.setItem('biztosfuvar_token', res.token);
      await AsyncStorage.setItem('biztosfuvar_user', JSON.stringify(res.user));
      router.replace('/fuvarok');
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
      <Text style={styles.hint}>Tipp: a seed scriptben minden mintafelhasználó jelszava: Jelszo123!</Text>
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
