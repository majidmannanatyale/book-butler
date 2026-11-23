// "Ask the Librarian" — a chat agent that reaches the collection only through
// the library MCP server's tools (and can only ever add to the wishlist).
import React, { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp } from 'react-native-reanimated';

import { IconClose } from '@/components/Icons';
import MicButton, { micAvailable } from '@/components/MicButton';
import { Caps, Chip, Italic, Rule, tap } from '@/components/ui';
import { api, money } from '@/api';
import { colors, fonts } from '@/theme';

type Msg = { role: 'reader' | 'librarian'; text: string; meta?: string };

const STARTERS = [
  'Which series am I closest to finishing?',
  'What should I read after Piranesi?',
  'Do I own anything by Ishiguro?',
];

export default function Librarian() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<any>(null);

  const askRef = useRef<(q: string) => void>(() => {});
  const onVoiceFinal = useCallback((t: string) => askRef.current(t), []);
  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    tap();
    setText('');
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: 'reader', text: question }]);
    setBusy(true);
    try {
      const r = await api.librarian(question, history);
      const tools = r.tools.length ? `consulted ${Array.from(new Set(r.tools)).join(', ')}` : 'from memory';
      setMsgs((m) => [...m, { role: 'librarian', text: r.answer.replace(/\*\*?([^*]+)\*\*?/g, '$1'), meta: `${tools} · ${money(r.usage.cost_usd)}` }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'librarian', text: e.message, meta: 'error' }]);
    }
    setBusy(false);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  askRef.current = ask;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.head, { paddingTop: insets.top + 10 }]}>
        <View>
          <Caps>At the desk</Caps>
          <Text style={{ fontFamily: fonts.script, fontSize: 34, color: colors.ink, lineHeight: 44 }}>The Librarian</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <IconClose color={colors.ink} />
        </Pressable>
      </View>
      <Rule style={{ marginHorizontal: 20 }} />
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 20, gap: 14 }}>
        {msgs.length === 0 && (
          <View style={{ gap: 10 }}>
            <Italic>Ask about your collection, its gaps, or what to look for next.</Italic>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {STARTERS.map((q) => (
                <Chip key={q} label={q} onPress={() => ask(q)} />
              ))}
            </View>
          </View>
        )}
        {msgs.map((m, i) => (
          <Animated.View key={i} entering={FadeInUp.duration(400)} style={m.role === 'reader' ? s.reader : s.librarian}>
            <Text style={m.role === 'reader' ? s.readerText : s.librarianText}>{m.text}</Text>
            {!!m.meta && <Caps style={{ fontSize: 8.5, marginTop: 6 }}>{m.meta}</Caps>}
          </Animated.View>
        ))}
        {busy && <Italic style={{ fontSize: 15 }}>The librarian is checking the shelves…</Italic>}
      </ScrollView>
      <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <MicButton onPartial={setText} onFinal={onVoiceFinal} />
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => ask(text)}
          placeholder={micAvailable() ? 'Ask — or tap the mic and speak…' : 'Ask the librarian…'}
          placeholderTextColor={colors.sepiaSoft}
          style={s.input}
          returnKeyType="send"
          maxLength={600}
          accessibilityLabel="Your question"
        />
        <Pressable onPress={() => ask(text)} disabled={busy} accessibilityRole="button" style={{ padding: 8 }}>
          <Caps style={{ color: colors.ink }}>Ask</Caps>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 20, paddingBottom: 8 },
  reader: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: colors.ink, padding: 12 },
  readerText: { fontFamily: fonts.body, color: colors.paper, fontSize: 16, lineHeight: 22 },
  librarian: { alignSelf: 'flex-start', maxWidth: '90%', borderLeftWidth: 1, borderColor: colors.gold, paddingLeft: 12 },
  librarianText: { fontFamily: fonts.displayItalic, color: colors.ink, fontSize: 19, lineHeight: 25 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  input: { flex: 1, fontFamily: fonts.bodyItalic, fontSize: 17, color: colors.ink, paddingVertical: 8 },
});
