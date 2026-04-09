// AI segéd chat képernyő mobilon.
// Egyszerű chat UI: lista + input. A history AsyncStorage-ben marad meg.
import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '@/api';
import { colors, spacing, radius } from '@/theme';

type Message = { role: 'user' | 'assistant'; content: string };

const STORAGE_KEY = 'biztosfuvar_ai_history';

const SUGGESTIONS = [
  'Hogyan adok fel új fuvart?',
  'Mi az a 6 jegyű kód?',
  'Mi a különbség a licit és a fix ár között?',
];

export default function AiChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // History betöltés
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setMessages(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  // History mentés
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(messages)).catch(() => {});
  }, [messages]);

  // Auto scroll
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const userMsg: Message = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    try {
      const res = await api.aiChat(trimmed, [...messages, userMsg]);
      setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Hiba: ${e.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function clearHistory() {
    setMessages([]);
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
      >
        {messages.length === 0 && (
          <>
            <Text style={styles.intro}>
              Szia! Miben segíthetek a BiztosFuvarral kapcsolatban?
            </Text>
            {SUGGESTIONS.map((s) => (
              <Pressable
                key={s}
                style={styles.suggestion}
                onPress={() => send(s)}
              >
                <Text style={styles.suggestionText}>💡 {s}</Text>
              </Pressable>
            ))}
          </>
        )}
        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.role === 'user' ? styles.bubbleUser : styles.bubbleBot,
            ]}
          >
            <Text style={m.role === 'user' ? styles.bubbleUserText : styles.bubbleBotText}>
              {m.content}
            </Text>
          </View>
        ))}
        {loading && (
          <View style={[styles.bubble, styles.bubbleBot]}>
            <Text style={styles.muted}>Írom a választ…</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Kérdezz…"
          editable={!loading}
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || loading) && { opacity: 0.4 }]}
          onPress={() => send(input)}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendBtnText}>Küldés</Text>
        </Pressable>
      </View>

      {messages.length > 0 && (
        <Pressable onPress={clearHistory} style={styles.clearBtn}>
          <Text style={styles.clearBtnText}>Előzmények törlése</Text>
        </Pressable>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  intro: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: spacing.sm },
  suggestion: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  suggestionText: { color: colors.text, fontSize: 14 },

  bubble: {
    padding: spacing.md,
    borderRadius: radius.md,
    maxWidth: '85%',
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    alignSelf: 'flex-end',
    borderBottomRightRadius: 4,
  },
  bubbleUserText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  bubbleBot: {
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleBotText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  muted: { color: colors.textMuted, fontSize: 13 },

  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
    color: colors.text,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  sendBtnText: { color: '#fff', fontWeight: '700' },

  clearBtn: { padding: spacing.sm, alignItems: 'center' },
  clearBtnText: { color: colors.textMuted, fontSize: 12 },
});
