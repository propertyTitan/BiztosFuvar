// Bejelentkezés + Regisztráció egyben — tab-váltóval.
// A tesztelők a publikus app-ban egyenesen rá kell, hogy tudjanak
// regisztrálni, mobile-on is (a seed user-ek csak a lokális DB-ben
// léteznek, a Neon prod DB üres).
import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '@/api';
import { setCurrentUser, homeForRole, Role } from '@/auth';
import { colors, spacing, radius } from '@/theme';

type Mode = 'login' | 'register';

export default function Bejelentkezes() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      Alert.alert('Hiányzó adat', 'Add meg az email címet és a jelszót.');
      return;
    }
    if (mode === 'register' && !fullName.trim()) {
      Alert.alert('Hiányzó adat', 'Add meg a teljes nevedet.');
      return;
    }
    if (mode === 'register' && password.length < 8) {
      Alert.alert('Túl rövid jelszó', 'A jelszó legalább 8 karakter legyen.');
      return;
    }

    setLoading(true);
    try {
      const res =
        mode === 'login'
          ? await api.login(cleanEmail, password)
          : await api.register({
              email: cleanEmail,
              password,
              full_name: fullName.trim(),
              phone: phone.trim() || undefined,
            });
      const role = (res.user.role as Role) || 'shipper';
      await setCurrentUser(
        {
          id: res.user.id,
          email: res.user.email,
          role,
          full_name: res.user.full_name,
        },
        res.token,
      );
      router.replace(homeForRole(role) as any);
    } catch (err: any) {
      Alert.alert(
        mode === 'login' ? 'Sikertelen bejelentkezés' : 'Sikertelen regisztráció',
        err.message,
      );
    } finally {
      setLoading(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {/* Tab-váltó */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, mode === 'login' && styles.tabActive]}
          onPress={() => switchMode('login')}
        >
          <Text style={[styles.tabText, mode === 'login' && styles.tabTextActive]}>
            Belépés
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, mode === 'register' && styles.tabActive]}
          onPress={() => switchMode('register')}
        >
          <Text style={[styles.tabText, mode === 'register' && styles.tabTextActive]}>
            Regisztráció
          </Text>
        </Pressable>
      </View>

      <Text style={styles.title}>
        {mode === 'login' ? 'Üdv újra! 👋' : 'Csatlakozz! 🚛'}
      </Text>
      <Text style={styles.subtitle}>
        {mode === 'login'
          ? 'Lépj be a fiókodba a folytatáshoz.'
          : 'Pár másodperc az egész. Ingyenes, nincs havidíj.'}
      </Text>

      {mode === 'register' && (
        <>
          <Text style={styles.label}>Teljes név</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Pl. Kovács Péter"
            placeholderTextColor={colors.textMuted}
          />
          <Text style={styles.label}>Telefon (opcionális)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+36 30 123 4567"
            placeholderTextColor={colors.textMuted}
          />
        </>
      )}

      <Text style={styles.label}>Email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="pelda@email.hu"
        placeholderTextColor={colors.textMuted}
      />

      <Text style={styles.label}>Jelszó</Text>
      <TextInput
        style={styles.input}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        placeholder={mode === 'register' ? 'Legalább 8 karakter' : ''}
        placeholderTextColor={colors.textMuted}
      />

      <Pressable style={styles.cta} disabled={loading} onPress={onSubmit}>
        <Text style={styles.ctaText}>
          {loading
            ? mode === 'login'
              ? 'Belépés…'
              : 'Regisztráció…'
            : mode === 'login'
            ? 'Belépés'
            : 'Fiók létrehozása'}
        </Text>
      </Pressable>

      {mode === 'register' && (
        <Text style={styles.hint}>
          A regisztrációval elfogadod az ÁSZF-et és az Adatvédelmi tájékoztatót.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.sm + 2,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
  },
  tabTextActive: {
    color: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  label: {
    color: colors.textMuted,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
    fontSize: 13,
  },
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
  ctaText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  hint: {
    color: colors.textMuted,
    marginTop: spacing.md,
    fontSize: 12,
    textAlign: 'center',
  },
});
