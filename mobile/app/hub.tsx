// Hub képernyő — a bejelentkezett user itt választ menüpontot.
// - FlatList numColumns=2 → mindig rendesen igazodó 2 oszlopos grid
// - Fix magasságú kártyák → nincs szakadás a wrap-nél, akkor se ha egy
//   subtitle több sorra tördelődik
// - Role-független: mindenki ugyanazt a 10 kártyát látja
//
// FONTOS: korábban `<Link href=... asChild><Pressable>` mintával navigáltunk,
// de ez a minta expo-routerben néha elnyelte az első kattintást (a Link csak
// a második render után volt teljesen bekötve az asChild Pressable-höz, és
// a user azt tapasztalta, hogy "kattintottam de a régi oldal maradt, majd
// másodikra jó lett"). Most explicit `router.push()`-t hívunk a Pressable
// `onPress`-én, ami mindig azonnal megtörténik.
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable, FlatList, RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
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
  badgeKey?: 'unread';
};

const CARDS: Card[] = [
  { href: '/fuvarok',             icon: '🎯', title: 'Licitálható fuvarok', subtitle: 'Nyitott hirdetések — licitálj',      accent: '#dbeafe' },
  { href: '/feladas/utvonalak',   icon: '🛣️', title: 'Fix áras fuvarok',    subtitle: 'Útvonalak, amelyekre foglalhatsz',  accent: '#dcfce7' },
  { href: '/sajat-fuvaraim',      icon: '🚛', title: 'Saját fuvarjaim',       subtitle: 'Amiket te teljesítesz sofőrként',   accent: '#fef3c7' },
  { href: '/feladas/foglalasaim', icon: '📦', title: 'Foglalásaim',          subtitle: 'Fix áras foglalásaid állapota',     accent: '#e0e7ff' },
  { href: '/feladas/uj',          icon: '📝', title: 'Új licites hirdetés',  subtitle: 'Sofőrök licitálnak rá',              accent: '#fce7f3' },
  { href: '/uj-utvonal',          icon: '➕', title: 'Új fix áras útvonal',  subtitle: 'Hirdesd meg a saját utad',           accent: '#f3e8ff' },
  { href: '/hirdeteseim',         icon: '📋', title: 'Saját hirdetéseim',    subtitle: 'Minden általad feladott hirdetés',   accent: '#fde68a' },
  { href: '/licitjeim',           icon: '🏷️', title: 'Licitjeim',            subtitle: 'Az ajánlataid egy helyen',           accent: '#bae6fd' },
  { href: '/ertesitesek',         icon: '🔔', title: 'Értesítések',          subtitle: 'Minden fontos esemény',              accent: '#ffe4e6', badgeKey: 'unread' },
  { href: '/ai-chat',             icon: '🤖', title: 'AI segéd',             subtitle: 'Kérdezz bármit a platformról',       accent: '#f3e8ff' },
];

export default function Hub() {
  const router = useRouter();
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

  function renderCard({ item: c }: { item: Card }) {
    const badge = c.badgeKey === 'unread' ? unread : 0;
    return (
      <Pressable style={styles.card} onPress={() => router.push(c.href as any)}>
        <View style={[styles.iconWrap, { backgroundColor: c.accent }]}>
          <Text style={styles.icon}>{c.icon}</Text>
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{c.title}</Text>
        <Text style={styles.cardSubtitle} numberOfLines={2}>{c.subtitle}</Text>
        {badge > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 99 ? '99+' : String(badge)}</Text>
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <FlatList
      data={CARDS}
      keyExtractor={(c) => c.href}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={false} onRefresh={load} tintColor={colors.primary} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.hello}>Szia, {user.full_name || user.email.split('@')[0]}! 👋</Text>
          <Text style={styles.subHello}>Válassz egy menüpontot a folytatáshoz.</Text>
        </View>
      }
      renderItem={renderCard}
    />
  );
}

const CARD_HEIGHT = 160;

const styles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  container: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  muted: { color: colors.textMuted },

  header: { marginBottom: spacing.md, paddingHorizontal: spacing.xs, paddingTop: spacing.sm },
  hello: { fontSize: 22, fontWeight: '800', color: colors.text },
  subHello: { color: colors.textMuted, fontSize: 14, marginTop: 4 },

  // numColumns={2} → minden sorban 2 kártya, automatikusan egyforma szélesség
  row: { justifyContent: 'space-between', marginBottom: spacing.md },

  card: {
    flex: 1,
    maxWidth: '48.5%',          // két oszlop + gap
    height: CARD_HEIGHT,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    position: 'relative',
    // Kis shadow, hogy a kártya pöpecebb legyen
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  icon: { fontSize: 22 },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 16,
  },

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
