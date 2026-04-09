// Értesítések képernyő mobilon.
// Real-time: új értesítés socketen érkezik és frissíti a listát.
import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, Pressable, StyleSheet, RefreshControl,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { getSocket, joinUserRoom } from '@/socket';
import { colors, spacing, radius } from '@/theme';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export default function Ertesitesek() {
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listNotifications();
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Real-time
  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      if (!u) return;
      joinUserRoom(u.id);
      const socket = getSocket();
      const onNew = (n: Notification) => {
        setItems((prev) => [n, ...prev.filter((x) => x.id !== n.id)]);
      };
      socket.on('notification:new', onNew);
      return () => socket.off('notification:new', onNew);
    })();
  }, []);

  async function openItem(n: Notification) {
    if (!n.read_at) {
      try {
        await api.markNotificationRead(n.id);
        setItems((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
        );
      } catch {}
    }
    // A web linkeket mobil routerre képezzük le: /dashboard/… → /feladas/…, /sofor/… → /…
    // Egyelőre a legegyszerűbb: ha a link a `/feladas/foglalasaim`, átirányítjuk
    // a mobil foglalasaim képernyőre; ha `/sofor/utvonal/xxx`, az utvonal/xxx-re.
    const link = n.link || '';
    if (link.startsWith('/dashboard/foglalasaim')) {
      router.push('/feladas/foglalasaim');
    } else if (link.startsWith('/dashboard/fuvar/')) {
      const id = link.split('/').pop();
      router.push({ pathname: '/feladas/[id]', params: { id: id as string } });
    } else if (link.startsWith('/sofor/utvonal/')) {
      const id = link.split('/').pop();
      router.push({ pathname: '/utvonal/[id]', params: { id: id as string } });
    } else if (link.startsWith('/sofor/fuvar/')) {
      const id = link.split('/').pop();
      router.push({ pathname: '/fuvar/[id]', params: { id: id as string } });
    }
    // Egyébként a képernyőn maradunk.
  }

  async function markAll() {
    try {
      await api.markAllNotificationsRead();
      setItems((prev) =>
        prev.map((x) => ({ ...x, read_at: x.read_at || new Date().toISOString() })),
      );
    } catch {}
  }

  const unreadCount = items.filter((n) => !n.read_at).length;

  return (
    <FlatList
      data={items}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ padding: spacing.md }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      ListHeaderComponent={
        unreadCount > 0 ? (
          <Pressable style={styles.markAllBtn} onPress={markAll}>
            <Text style={styles.markAllText}>Összes olvasottra ({unreadCount})</Text>
          </Pressable>
        ) : null
      }
      ListEmptyComponent={
        !loading ? <Text style={styles.empty}>Még nincs értesítésed.</Text> : null
      }
      renderItem={({ item }) => (
        <Pressable
          style={[styles.card, !item.read_at && styles.unread]}
          onPress={() => openItem(item)}
        >
          <Text style={styles.title}>{item.title}</Text>
          {item.body && <Text style={styles.body}>{item.body}</Text>}
          <Text style={styles.time}>
            {new Date(item.created_at).toLocaleString('hu-HU')}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  markAllBtn: {
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  markAllText: { color: colors.primary, fontWeight: '600' },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unread: { backgroundColor: '#eff6ff', borderLeftWidth: 4, borderLeftColor: colors.primary },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  body: { fontSize: 13, color: colors.text, marginTop: 4, lineHeight: 18 },
  time: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
});
