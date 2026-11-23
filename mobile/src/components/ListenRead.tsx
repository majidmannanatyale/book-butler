// Listen & read: free options first (LibriVox audiobooks, Open Library read/borrow),
// then Spotify, Audible, Kindle, Google Play Books and Libby.
import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Caps, tap } from '@/components/ui';
import { api, ListenLink } from '@/api';
import { colors, fonts } from '@/theme';

const ICON: Record<string, string> = { audiobook: '♪', ebook: '❦', borrow: '⌂' };

export default function ListenRead({ title, author, dark = false }: { title: string; author: string; dark?: boolean }) {
  const [data, setData] = useState<{ free: ListenLink[]; links: ListenLink[] } | null>(null);
  useEffect(() => {
    api.listen(title, author).then(setData).catch(() => {});
  }, [title, author]);
  if (!data) return null;
  const open = (u: string) => {
    tap();
    Linking.openURL(u);
  };
  return (
    <Animated.View entering={FadeIn} style={{ marginTop: 16 }}>
      <Caps style={{ color: dark ? colors.wallMuted : colors.sepia }}>Listen & read</Caps>
      {data.free.map((f) => (
        <Pressable key={f.name} onPress={() => open(f.url)} style={s.free} accessibilityRole="link">
          <Text style={s.icon}>{ICON[f.kind] || '❦'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.freeName}>{`${f.name} — free`}</Text>
            <Text style={s.detail}>{f.detail}</Text>
          </View>
          <Caps style={{ color: colors.gold, fontSize: 9 }}>open →</Caps>
        </Pressable>
      ))}
      <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingTop: 10 }}>
        {data.links.map((l) => (
          <Pressable key={l.name} onPress={() => open(l.url)} style={s.chip} accessibilityRole="link" accessibilityLabel={`${l.name}: ${l.detail}`}>
            <Text style={s.chipText}>{`${ICON[l.kind] || ''} ${l.name}`}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  free: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  icon: { fontSize: 20, color: colors.gold, width: 24, textAlign: 'center' },
  freeName: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  detail: { fontFamily: fonts.bodyItalic, fontSize: 13.5, color: colors.inkSoft },
  chip: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(242,181,58,0.55)', paddingVertical: 8, paddingHorizontal: 12 },
  chipText: { fontFamily: fonts.body, fontSize: 13.5, color: colors.ink },
});
