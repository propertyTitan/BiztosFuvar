// Chat-szál a fuvar/foglalás detail oldal alján — mind a feladó mind
// a sofőr használja. A driver-oldali fuvar/[id]-n már volt inline
// implementáció; most kiemeltük közös komponensbe és a feladói oldalon
// is megjelenik.
//
// Realtime: a `chat:job:<id>` szobára iratkozik fel a Socket.IO-n,
// ott jönnek az új üzenetek (mind a saját, mind a másik féltől).

import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView } from 'react-native';
import { api } from '@/api';
import { getCurrentUser } from '@/auth';
import { getSocket } from '@/socket';
import { useToast } from '@/components/ToastProvider';
import { colors, spacing, radius } from '@/theme';

type Props = {
  jobId?: string;
  bookingId?: string;
  /** Csak ezekben az állapotokban jelenik meg a chat. */
  status: string;
  /** Title override; default: \"💬 Chat a fuvarpartnerrel\" */
  title?: string;
};

const VISIBLE_STATUSES = ['accepted', 'in_progress', 'delivered', 'completed'];

export default function ChatSection({ jobId, bookingId, status, title }: Props) {
  const toast = useToast();
  const [meId, setMeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => setMeId(u?.id || null));
  }, []);

  useEffect(() => {
    if (!VISIBLE_STATUSES.includes(status)) return;
    if (!jobId && !bookingId) return;

    api.getMessages({ job_id: jobId, booking_id: bookingId })
      .then((m: any[]) => {
        setMessages(m);
        // Scroll to bottom on first load
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 100);
      })
      .catch(() => {});

    // Socket subscribe
    const socket = getSocket();
    if (!socket) return;
    const roomKey = jobId ? `chat:job:${jobId}` : `chat:booking:${bookingId}`;
    const onMsg = (msg: any) => {
      setMessages((prev) => prev.some((m: any) => m.id === msg.id) ? prev : [...prev, msg]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    };
    socket.on(roomKey, onMsg);
    return () => { socket.off(roomKey, onMsg); };
  }, [jobId, bookingId, status]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const msg = await api.sendMessage({ job_id: jobId, booking_id: bookingId, body: text });
      setMessages((prev) => prev.some((m: any) => m.id === msg.id) ? prev : [...prev, msg]);
      setInput('');
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) {
      toast.error('Hiba', e.message);
    } finally {
      setSending(false);
    }
  }

  if (!VISIBLE_STATUSES.includes(status)) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{title || '💬 Chat a fuvarpartnerrel'}</Text>
      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={{ gap: 6, padding: spacing.sm }}
      >
        {messages.length === 0 && (
          <Text style={styles.empty}>Még nincs üzenet. Írj először!</Text>
        )}
        {messages.map((m: any) => (
          <View
            key={m.id}
            style={[
              styles.bubble,
              m.sender_id === meId ? styles.bubbleMine : styles.bubbleOther,
            ]}
          >
            {m.sender_id !== meId && m.sender_name && (
              <Text style={styles.sender}>{m.sender_name}</Text>
            )}
            <Text style={m.sender_id === meId ? styles.textMine : styles.textOther}>{m.body}</Text>
            <Text style={styles.time}>
              {new Date(m.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Írj üzenetet…"
          placeholderTextColor={colors.textMuted}
          editable={!sending}
          returnKeyType="send"
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
          onPress={send}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendText}>Küldés</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  title: { padding: spacing.md, fontSize: 14, fontWeight: '800', color: colors.text },
  list: { maxHeight: 250 },
  empty: { color: colors.textMuted, fontSize: 13, textAlign: 'center', padding: spacing.md },
  bubble: { padding: spacing.sm, borderRadius: radius.md, maxWidth: '80%' },
  bubbleMine: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: colors.background,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sender: { fontSize: 10, fontWeight: '700', color: colors.textMuted, marginBottom: 2 },
  textMine: { color: '#fff', fontSize: 14 },
  textOther: { color: colors.text, fontSize: 14 },
  time: { fontSize: 9, opacity: 0.6, marginTop: 2, textAlign: 'right' },
  inputRow: {
    flexDirection: 'row', gap: spacing.sm, padding: spacing.sm,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: 8, fontSize: 14,
    backgroundColor: colors.background, color: colors.text,
  },
  sendBtn: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.md,
    justifyContent: 'center', borderRadius: radius.md,
  },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
