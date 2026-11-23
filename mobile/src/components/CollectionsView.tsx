// Your collections, laid out like the real thing:
//  · series in reading order, with dotted empty slots for the volumes you're missing
//  · the same book in several editions, side by side ("3 editions")
//  · authors you've collected deeply
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';

import BookCover from '@/components/BookCover';
import { Caps, Italic, tap } from '@/components/ui';
import { api, Book } from '@/api';
import { colors, fonts } from '@/theme';

type Def = { name: string; author: string; members: string[] };

const norm = (t: string) =>
  (t || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(':')[0]
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .replace(/\s+/g, ' ')
    .trim();
const surname = (a: string) => norm(a).split(' ').pop() || '';

const W = 66;

export default function CollectionsView({ books }: { books: Book[] }) {
  const router = useRouter();
  const [defs, setDefs] = useState<Def[]>([]);
  useEffect(() => {
    api
      .collections()
      .then((r) => setDefs(r.collections))
      .catch(() => {});
  }, []);

  const owned = books.filter((b) => b.status === 'owned');

  const series = useMemo(() => {
    const rows = defs.map((d) => {
      const slots = d.members.map((title, i) => ({
        title,
        index: i + 1,
        copies: owned.filter((b) => (b.collection === d.name && b.series_index === i + 1) || norm(b.title) === norm(title)),
      }));
      return { name: d.name, author: d.author, slots, have: slots.filter((s) => s.copies.length).length };
    });
    // series the reader created themselves (collection field) that have no definition yet
    const known = new Set(defs.map((d) => d.name));
    const extra: Record<string, Book[]> = {};
    owned.forEach((b) => {
      if (b.collection && !known.has(b.collection)) (extra[b.collection] ||= []).push(b);
    });
    Object.entries(extra).forEach(([name, bs]) => {
      const sorted = bs.sort((a, b) => (a.series_index || 99) - (b.series_index || 99));
      rows.push({ name, author: sorted[0].author, have: sorted.length, slots: sorted.map((b, i) => ({ title: b.title, index: b.series_index || i + 1, copies: [b] })) });
    });
    return rows.filter((r) => r.have > 0).sort((a, b) => b.have / b.slots.length - a.have / a.slots.length);
  }, [defs, books]);

  const editions = useMemo(() => {
    const g: Record<string, Book[]> = {};
    owned.forEach((b) => (g[`${norm(b.title)}|${surname(b.author)}`] ||= []).push(b));
    return Object.values(g).filter((v) => v.length > 1);
  }, [books]);

  const authors = useMemo(() => {
    const g: Record<string, Book[]> = {};
    owned.forEach((b) => b.author && (g[b.author] ||= []).push(b));
    return Object.entries(g)
      .filter(([, v]) => v.length >= 3)
      .sort((a, b) => b[1].length - a[1].length);
  }, [books]);

  const open = (b: Book) => {
    tap();
    router.push(`/book/${b.id}`);
  };
  const find = (title: string, author: string) => {
    tap();
    router.push({ pathname: '/pick', params: { title, author, stars: '4', reason: 'Completes a series you collect' } });
  };

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 50 }}>
      {series.map((sr, i) => (
        <Animated.View key={sr.name} entering={FadeInDown.delay(i * 70)} style={s.block}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{sr.name}</Text>
              <Italic style={{ fontSize: 13 }}>{sr.author}</Italic>
            </View>
            <Text style={s.count}>{`${sr.have} / ${sr.slots.length}`}</Text>
          </View>
          <View style={s.bar}>
            <View style={[s.barFill, { flex: sr.have }]} />
            <View style={{ flex: Math.max(0, sr.slots.length - sr.have) }} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 12 }}>
            {sr.slots.map((sl) =>
              sl.copies.length ? (
                sl.copies.map((b, k) => (
                  <Pressable key={b.id} onPress={() => open(b)} style={{ width: W }}>
                    <BookCover title={b.title} author={b.author} uri={b.cover_url} width={W} />
                    <Caps style={s.vol}>{k ? `vol. ${sl.index} · ed. ${k + 1}` : `vol. ${sl.index}`}</Caps>
                  </Pressable>
                ))
              ) : (
                <Pressable key={`m${sl.index}`} onPress={() => find(sl.title, sr.author)} style={{ width: W }} accessibilityLabel={`Missing: ${sl.title}`}>
                  <View style={s.missing}>
                    <Text style={s.missingNum}>{sl.index}</Text>
                    <Text numberOfLines={4} style={s.missingTitle}>{sl.title}</Text>
                  </View>
                  <Caps style={[s.vol, { color: colors.gold }]}>find it →</Caps>
                </Pressable>
              ),
            )}
          </ScrollView>
        </Animated.View>
      ))}

      {editions.length > 0 && (
        <View style={s.block}>
          <Caps style={{ color: colors.ink }}>Several editions</Caps>
          {editions.map((eds) => (
            <View key={eds[0].id} style={{ marginTop: 12 }}>
              <Text style={s.name}>{`${eds[0].title} · ${eds.length} editions`}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 8 }}>
                {eds.map((b) => (
                  <Pressable key={b.id} onPress={() => open(b)} style={{ width: W + 10 }}>
                    <BookCover title={b.title} author={b.author} uri={b.cover_url} width={W} />
                    <Caps style={s.vol} numberOfLines={2}>{[b.edition, b.binding, b.year].filter(Boolean).join(' · ') || 'edition'}</Caps>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}
        </View>
      )}

      {authors.length > 0 && (
        <View style={s.block}>
          <Caps style={{ color: colors.ink }}>Authors you collect</Caps>
          {authors.map(([author, bs]) => (
            <View key={author} style={{ marginTop: 12 }}>
              <Text style={s.name}>{`${author} · ${bs.length}`}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingTop: 8 }}>
                {bs.map((b) => (
                  <Pressable key={b.id} onPress={() => open(b)} style={{ width: W }}>
                    <BookCover title={b.title} author={b.author} uri={b.cover_url} width={W} />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ))}
        </View>
      )}
      {!series.length && !editions.length && !authors.length && (
        <Italic style={{ textAlign: 'center', padding: 40 }}>Collections appear as your shelves grow.</Italic>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  block: { paddingHorizontal: 20, paddingTop: 22 },
  head: { flexDirection: 'row', alignItems: 'flex-end' },
  name: { fontFamily: fonts.display, fontSize: 21, color: colors.ink },
  count: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.gold },
  bar: { height: 2, flexDirection: 'row', backgroundColor: colors.line, marginTop: 8 },
  barFill: { backgroundColor: colors.gold },
  vol: { fontSize: 8, marginTop: 4, letterSpacing: 1 },
  missing: {
    width: W,
    height: W * 1.5,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(242,181,58,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 4,
  },
  missingNum: { fontFamily: fonts.displayLight, fontSize: 26, color: colors.gold },
  missingTitle: { fontFamily: fonts.bodyItalic, fontSize: 9.5, color: colors.inkSoft, textAlign: 'center' },
});
