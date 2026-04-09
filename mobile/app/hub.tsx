// Hub képernyő — a bejelentkezett user itt választ menüpontot.
// Kártya-rácsos felület, role-szerint más-más tartalommal.
// Real-time értesítés számláló: a 🔔 kártya badge-e frissül, ahogy újak jönnek.
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, RefreshControl,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { getCurrentUser, CurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import { colors, spacing, radius } from '@/theme';

type Card = {
  href: string;
  icon: string;
  title: string;
  subtitle: string;
  accent: string;
  badge?: number;
};

// Egységes menü mindenkinek — bárki lehet feladó ÉS sofőr is.
const CARDS: Omit<Card, 'badge'>[] = [
  { href: '/fuvarok',               icon: '🎯', title: 'Licitálható fuvarok',      subtitle: 'Nyitott hirdetések — licitálj', accent: '#dbeafe' },
  { href: '/feladas/utvonalak',     icon: '🛣️', title: 'Fix áras fuvarok',         subtitle: 'Útvonalak, amelyekre foglalhatsz', accent: '#dcfce7' },
  { href: '/sajat-fuvaraim',        icon: '🚛', title: 'Fuvaraim',                  subtitle: 'Amiket TE teljesítesz sofőrként', accent: '#fef3c7' },
  { href: '/feladas/foglalasaim',   icon: '📦', title: 'Foglalásaim',               subtitle: 'Amiket TE foglaltál egy útvonalon', accent: '#e0e7ff' },
  { href: '/feladas/uj',            icon: '📝', title: 'Új licites hirdetés',      subtitle: 'Sofőrök licitálnak rá', accent: '#fce7f3' },
  { href: '/uj-utvonal',            icon: '➕', title: 'Új fix áras útvonal',      subtitle: 'Hirdesd meg a saját utad', accent: '#f3e8ff' },
  { href: '/hirdeteseim',           icon: '📋', title: 'Saját hirdetéseim',        subtitle: 'Minden általad feladott hirdetés', accent: '#fde68a' },
  { href: '/licitjeim',             icon: '🏷️', title: 'Licitjeim',                subtitle: 'Az ajánlataid egy helyen', accent: '#bae6fd' },
  { href: '/ertesitesek',           icon: '🔔', title: 'Értesítések',              subtitle: 'Minden fontos esemény', accent: '#ffe4e6' },
  { href: '/ai-chat',               icon: '🤖', title: 'AI segéd',                 subtitle: 'Kérdezz bármit a platformról', accent: '#f3e8ff' },
];

export default function Hub() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const u = await getCurrentUser();
    setUser(u);
    if (u) {
      joinUserRoom(u.id);
      try {
        const r = await api.unreadNotificationCount();
        setUnread(r.count);
      } catch {}
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Real-time: új értesítés → badge +1
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    const onNew = () => setUnread((c) => c + 1);
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [user]);

  if (!user) {
    return (
      <View style={styles.loading}>
        <Text style={styles.muted}>Betöltés…</Text>
      </View>
    );
  }

  const cards = CARDS;

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />}
    >
      <Text style={styles.hello}>Szia, {user.full_name || user.email}! 👋</Text>
      <Text style={styles.subHello}>
        Válassz egy menüpontot a folytatáshoz.
      </Text>

      <View style={styles.grid}>
        {cards.map((c) => (
          <Link key={c.href} href={c.href as any} asChild>
            <Pressable style={[styles.card, { borderTopColor: c.accent }]}>
              <View style={[styles.iconWrap, { backgroundColor: c.accent }]}>
                <Text style={styles.icon}>{c.icon}</Text>
              </View>
              <Text style={styles.cardTitle}>{c.title}</Text>
              <Text style={styles.cardSubtitle}>{c.subtitle}</Text>
              {c.href === '/ertesitesek' && unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
                </View>
              )}
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  container: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  hello: { fontSize: 22, fontWeight: '800', color: colors.text },
  subHello: { color: colors.textMuted, fontSize: 14, marginTop: 4, marginBottom: spacing.lg },
  muted: { color: colors.textMuted },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  card: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 4,
    position: 'relative',
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  icon: { fontSize: 24 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 2 },
  cardSubtitle: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },

  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#ef4444',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
