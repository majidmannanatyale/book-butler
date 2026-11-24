// On a book's page: the other copies you own of the same title (other editions), and the series
// it belongs to, volume by volume: which you have (tap to open) and which are still missing
// (tap to look for it).
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { api, Book, Related } from '@/api';
import { Caps, tap } from '@/components/ui';
import { colors, fonts } from '@/theme';

export default function RelatedBooks({ book }: { book: Book }) {
  const router = useRouter();
  const [rel, setRel] = useState<Related | null>(null);
  useEffect(() => {
    let alive = true;
    api.related(book.id).then((r) => alive && setRel(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [book.id, book.collection, book.title]);
  if (!rel) return null;
  const { copies, series } = rel;
  const others = series ? series.members.filter((m) => !m.current) : [];
  const have = series ? series.members.filter((m) => m.owned).length : 0;
  const missing = series ? series.members.filter((m) => !m.owned) : [];
  if (!copies.length && !others.length) return null;
  // the words every volume's title shares ("Harry Potter and the") are dropped from the list
  const words = series ? series.members.map((m) => m.title.split(' ')) : [];
  let shared = 0;
  while (words.length > 1 && words.every((w) => w.length > shared + 1 && w[shared].toLowerCase() === words[0][shared].toLowerCase())) shared++;
  const short = (t: string) => (shared >= 2 ? t.split(' ').slice(shared).join(' ').replace(/^./, (c) => c.toUpperCase()) : t);
  const open = (id: number) => {
    tap();
    router.push(`/book/${id}`);
  };
  return (
    <View>
      {copies.length > 0 && (
        <View style={s.block}>
          <Caps style={s.head}>{copies.length === 1 ? 'You own another copy' : `You own ${copies.length} other copies`}</Caps>
          {copies.map((c) => (
            <Pressable key={c.id} onPress={() => open(c.id)} style={s.row} accessibilityRole="button" accessibilityLabel={`Open your other copy of ${c.title}`}>
              <Text style={s.mark}>❦</Text>
              <Text style={s.title} numberOfLines={1}>
                {[c.publisher, c.year, c.binding, c.edition].filter((v, i, all) => v && all.findIndex((w) => String(w).toLowerCase() === String(v).toLowerCase()) === i).join(' · ') || 'Another edition'}
                {c.status === 'wishlist' ? ' (wishlist)' : ''}
              </Text>
              <Text style={s.go}>open →</Text>
            </Pressable>
          ))}
        </View>
      )}
      {series && others.length > 0 && (
        <View style={s.block}>
          <Caps style={s.head}>{`${series.name} · ${have} of ${series.members.length} on your shelves`}</Caps>
          {series.members.map((m, i) => (
            <Pressable
              key={`${m.index}-${i}`}
              disabled={m.current}
              onPress={() => {
                if (m.owned && m.id) open(m.id);
                else {
                  tap();
                  router.push({ pathname: '/pick', params: { title: m.title, author: series.author || '', stars: '4', reason: `Vol. ${m.index} of ${series.name}, missing from your collection` } });
                }
              }}
              style={s.row}
              accessibilityRole="button"
              accessibilityLabel={m.owned ? `Open ${m.title}` : `Find ${m.title}, missing from the collection`}
            >
              <Text style={[s.num, m.current && { color: colors.gold }]}>{m.index ?? '·'}</Text>
              <Text style={[s.title, !m.owned && s.missing, m.current && s.current]} numberOfLines={1}>
                {short(m.title)}
              </Text>
              <Text style={[s.go, !m.owned && { color: colors.gold }]}>{m.current ? 'this volume' : m.owned ? '✓ owned' : 'missing →'}</Text>
            </Pressable>
          ))}
          {missing.length > 0 && (
            <Text style={s.note}>{`${missing.length} ${missing.length === 1 ? 'volume' : 'volumes'} still to find. The Book Finder will flag ${missing.length === 1 ? 'it' : 'them'} on a shop shelf.`}</Text>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  block: { marginTop: 18 },
  head: { color: colors.sepia, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line, gap: 10 },
  mark: { color: colors.gold, fontSize: 14, width: 18, textAlign: 'center' },
  num: { fontFamily: fonts.body, color: colors.sepia, fontSize: 14, width: 18, textAlign: 'center' },
  title: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  missing: { fontFamily: fonts.bodyItalic, color: colors.sepia },
  current: { color: colors.gold },
  go: { fontFamily: fonts.bodyItalic, fontSize: 13, color: colors.sepia },
  note: { fontFamily: fonts.bodyItalic, fontSize: 13, color: colors.sepia, marginTop: 8 },
});
