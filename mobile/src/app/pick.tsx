// "Why this pick?" — tap any recommendation to see how it connects to the
// reader's own shelf (only real books they own), its themes, and an honest caveat.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import BookCover from '@/components/BookCover';
import SampleCard from '@/components/SampleCard';
import FindIt from '@/components/FindIt';
import Stars from '@/components/Stars';
import { IconClose } from '@/components/Icons';
import { Button, Caps, ErrorNote, Italic, Ornament, tap } from '@/components/ui';
import { api, Explanation, money } from '@/api';
import { colors, fonts } from '@/theme';

export default function Pick() {
  const p = useLocalSearchParams<{ title: string; author: string; stars: string; reason: string; cover?: string; collectible?: string; why?: string; price?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const stars = Number(p.stars || 3);
  const [exp, setExp] = useState<Explanation | null>(null);
  const [meta, setMeta] = useState<any>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<'' | 'owned' | 'wishlist'>('');

  useEffect(() => {
    api
      .explain({ title: p.title, author: p.author || '', stars, reason: p.reason || '' })
      .then((r) => {
        setExp(r.explanation);
        setMeta(r.meta);
        setCost(r.cached ? 0 : r.usage?.cost_usd ?? null);
      })
      .catch((e) => setError(e.message));
  }, [p.title]);

  const save = async (status: 'owned' | 'wishlist') => {
    tap();
    try {
      await api.addBook({ title: p.title, author: p.author || '', status, cover_url: meta?.cover_url ?? null, year: meta?.year ?? null, subjects: meta?.subjects ?? [] });
      setSaved(status);
    } catch {}
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.wall }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: 50 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Caps color={colors.wallMuted}>Why this pick</Caps>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
            <IconClose color={colors.wallText} />
          </Pressable>
        </View>

        <View style={{ flexDirection: 'row', gap: 18, marginTop: 18 }}>
          <BookCover title={p.title} author={p.author} uri={meta?.cover_url || p.cover} width={104} />
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Text style={s.title}>{p.title}</Text>
            {!!p.author && <Italic color={colors.wallMuted} style={{ fontSize: 16 }}>{p.author}{meta?.year ? `, ${meta.year}` : ''}</Italic>}
            <View style={{ marginTop: 8 }}>
              <Stars n={stars} size={15} />
            </View>
            <Caps color={colors.wallMuted} style={{ fontSize: 8.5, marginTop: 4 }}>{`${stars} of 5 · how sure the curator is you'll love it`}</Caps>
          </View>
        </View>

        {!!error && <ErrorNote dark message={error} />}
        {!exp && !error && (
          <Italic color={colors.wallMuted} style={{ marginTop: 24 }}>
            The curator is looking along your shelves…
          </Italic>
        )}
        {exp && (
          <Animated.View entering={FadeIn.duration(500)}>
            <Text style={s.headline}>{exp.headline}</Text>
            {exp.connections.length > 0 && (
              <>
                <Caps color={colors.gold} style={{ marginTop: 22 }}>Because you own</Caps>
                {exp.connections.map((c, i) => (
                  <Animated.View key={i} entering={FadeInDown.delay(120 * i)} style={s.conn}>
                    <Text style={s.connTitle}>{c.your_book}</Text>
                    <Text style={s.connWhy}>{c.why}</Text>
                  </Animated.View>
                ))}
              </>
            )}
            {exp.themes.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                {exp.themes.map((t) => (
                  <View key={t} style={s.theme}>
                    <Caps color={colors.inkSoft} style={{ fontSize: 9 }}>{t}</Caps>
                  </View>
                ))}
              </View>
            )}
            {!!exp.caveat && (
              <>
                <Caps color={colors.wallMuted} style={{ marginTop: 22 }}>Worth knowing</Caps>
                <Italic color={colors.wallText} style={{ fontSize: 16, marginTop: 4 }}>{exp.caveat}</Italic>
              </>
            )}
            {cost != null && (
              <Caps color={colors.sepiaSoft} style={{ fontSize: 8, marginTop: 14 }}>{cost === 0 ? 'explained before · from cache' : `explained for ${money(cost)}`}</Caps>
            )}
          </Animated.View>
        )}

        <FindIt title={p.title} author={p.author || ''} collectible={p.collectible === '1'} collectibleWhy={p.why} priceSeen={p.price} />

        <Ornament dark />
        <SampleCard load={() => api.sampleByTitle(p.title, p.author || '')} />

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          {saved ? (
            <Caps color={colors.owned}>{saved === 'owned' ? '✓ Added to your library' : '♡ On your wishlist'}</Caps>
          ) : (
            <>
              <Button kind="outline" label="Want it" style={{ flex: 1 }} onPress={() => save('wishlist')} />
              <Button label="I own it" style={{ flex: 1 }} onPress={() => save('owned')} />
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.wallText, lineHeight: 31 },
  headline: { fontFamily: fonts.displayItalic, fontSize: 22, color: colors.wallText, lineHeight: 29, marginTop: 24 },
  conn: { marginTop: 10, borderLeftWidth: 2, borderColor: colors.gold, paddingLeft: 12 },
  connTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.wallText },
  connWhy: { fontFamily: fonts.bodyItalic, fontSize: 14, color: colors.wallMuted, lineHeight: 19 },
  theme: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 5 },
});
