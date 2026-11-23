import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import Animated, { FadeIn } from 'react-native-reanimated';

import BookCover from '@/components/BookCover';
import { IconHeart } from '@/components/Icons';
import { Button, Caps, Chip, Display, ErrorNote, Italic, Rule, tap } from '@/components/ui';
import { api, Book, getBase } from '@/api';
import Shelf3D from '@/components/Shelf3D';
import { colors, fonts } from '@/theme';

type Filter = 'all' | 'favourites' | 'reading' | 'wishlist' | string;

export default function Library() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [books, setBooks] = useState<Book[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [arrange, setArrange] = useState(false);
  const [view, setView] = useState<'shelf' | 'grid'>('shelf');
  const [base, setBaseUrl] = useState('');
  React.useEffect(() => {
    getBase().then(setBaseUrl);
  }, []);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setBooks(await api.books('all'));
      setError('');
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const collections = useMemo(
    () => Array.from(new Set(books.map((b) => b.collection).filter(Boolean))) as string[],
    [books],
  );

  const visible = books.filter((b) => {
    if (filter === 'wishlist') {
      if (b.status !== 'wishlist') return false;
    } else if (b.status !== 'owned') return false;
    if (filter === 'favourites' && !b.favourite) return false;
    if (filter === 'reading' && !b.reading) return false;
    if (!['all', 'favourites', 'reading', 'wishlist'].includes(filter) && b.collection !== filter) return false;
    if (q.trim()) {
      const hay = `${b.title} ${b.author} ${b.collection ?? ''} ${b.edition ?? ''} ${(b.subjects || []).join(' ')}`.toLowerCase();
      return q
        .toLowerCase()
        .split(/\s+/)
        .every((t) => hay.includes(t));
    }
    return true;
  });

  const cols = 3;
  const gap = 18;
  const cw = (width - 40 - gap * (cols - 1)) / cols;

  const header = (
    <View style={{ paddingTop: insets.top + 18, paddingHorizontal: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Caps>{`${books.filter((b) => b.status === 'owned').length} volumes`}</Caps>
          <Display>The Collection</Display>
        </View>
        <Pressable
          onPress={() => {
            tap();
            router.push('/librarian');
          }}
          accessibilityRole="button"
          style={s.askBtn}
        >
          <Text style={{ fontFamily: fonts.script, fontSize: 22, color: colors.gold, lineHeight: 26 }}>Ask</Text>
          <Caps style={{ fontSize: 9 }}>the librarian</Caps>
        </Pressable>
      </View>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search title, author, subject…"
        placeholderTextColor={colors.sepiaSoft}
        style={s.search}
        accessibilityLabel="Search your library"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
        {(['all', 'favourites', 'reading', 'wishlist'] as const).map((f) => (
          <Chip key={f} label={f === 'reading' ? 'Reading now' : f} active={filter === f} onPress={() => setFilter(f)} />
        ))}
        {collections.map((c) => (
          <Chip key={c} label={c} active={filter === c} onPress={() => setFilter(c)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Italic style={{ fontSize: 15 }}>{arrange ? 'Hold and drag to rearrange your shelf.' : `${visible.length} shown`}</Italic>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          {!arrange && (
            <Pressable onPress={() => { tap(); setView((v) => (v === 'shelf' ? 'grid' : 'shelf')); }} hitSlop={8}>
              <Caps style={{ color: colors.gold }}>{view === 'shelf' ? 'Gallery' : 'Bookcase'}</Caps>
            </Pressable>
          )}
          {filter === 'all' && !q && (
            <Pressable onPress={() => { tap(); setArrange((a) => !a); }} hitSlop={8}>
              <Caps style={{ color: colors.ink }}>{arrange ? 'Done' : 'Arrange'}</Caps>
            </Pressable>
          )}
        </View>
      </View>
      <Rule />
      {!!error && <ErrorNote message={error} />}
    </View>
  );

  if (arrange) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <DraggableFlatList
          data={visible}
          keyExtractor={(b) => String(b.id)}
          ListHeaderComponent={header}
          onDragEnd={({ data }) => {
            const ids = data.map((b) => b.id);
            const rest = books.filter((b) => !ids.includes(b.id));
            setBooks([...data, ...rest]);
            api.reorder([...ids, ...rest.map((b) => b.id)]).catch(() => {});
          }}
          renderItem={({ item, drag, isActive }: RenderItemParams<Book>) => (
            <ScaleDecorator>
              <Pressable onLongPress={drag} delayLongPress={150} style={[s.row, isActive && { backgroundColor: colors.paperDeep }]}>
                <BookCover title={item.title} author={item.author} uri={item.cover_url} width={34} />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Italic style={{ fontSize: 14 }}>{item.author}</Italic>
                </View>
                <Text style={{ color: colors.sepia, fontSize: 18 }}>≡</Text>
              </Pressable>
            </ScaleDecorator>
          )}
        />
      </View>
    );
  }

  if (view === 'shelf' && base) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        {header}
        {visible.length > 0 ? (
          <Shelf3D books={visible} base={base} onOpen={(id) => router.push(`/book/${id}`)} />
        ) : (
          <Italic style={{ textAlign: 'center', padding: 40 }}>Nothing on this shelf yet.</Italic>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <FlatList
        data={visible}
        key="grid"
        numColumns={cols}
        keyExtractor={(b) => String(b.id)}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap, paddingHorizontal: 20 }}
        contentContainerStyle={{ paddingBottom: 40, gap: 22 }}
        ListEmptyComponent={
          <View style={{ padding: 40, alignItems: 'center' }}>
            <Italic style={{ textAlign: 'center' }}>
              {filter === 'wishlist' ? 'No wishes yet. The Book Finder can add some.' : 'Nothing here yet.'}
            </Italic>
          </View>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeIn.delay(Math.min(index, 12) * 40).duration(400)} style={{ width: cw }}>
            <Pressable
              onPress={() => {
                tap();
                router.push(`/book/${item.id}`);
              }}
              accessibilityLabel={`${item.title} by ${item.author}`}
            >
              <BookCover title={item.title} author={item.author} uri={item.cover_url} width={cw} />
              {item.favourite && (
                <View style={s.fav}>
                  <IconHeart color={colors.gold} size={14} filled />
                </View>
              )}
              <Text numberOfLines={2} style={s.gridTitle}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={s.gridAuthor}>
                {item.author}
              </Text>
              {item.reading && (
                <View style={s.progressTrack}>
                  <View style={[s.progressFill, { width: `${Math.round(item.progress * 100)}%` }]} />
                </View>
              )}
            </Pressable>
          </Animated.View>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  askBtn: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  search: {
    marginTop: 14,
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    fontFamily: fonts.bodyItalic,
    fontSize: 17,
    color: colors.ink,
  },
  gridTitle: { fontFamily: fonts.display, fontSize: 15, color: colors.ink, marginTop: 8, lineHeight: 17 },
  gridAuthor: { fontFamily: fonts.bodyItalic, fontSize: 12.5, color: colors.sepia, marginTop: 1 },
  fav: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(238,232,220,0.9)', borderRadius: 12, padding: 3 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.paper,
  },
  rowTitle: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  progressTrack: { height: 1, backgroundColor: colors.line, marginTop: 6 },
  progressFill: { height: 1, backgroundColor: colors.gold },
});
