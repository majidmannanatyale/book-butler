import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import Animated, { FadeIn } from 'react-native-reanimated';

import BookCover from '@/components/BookCover';
import { IconHeart } from '@/components/Icons';
import { Button, Caps, Chip, Display, ErrorNote, Italic, Rule, tap } from '@/components/ui';
import { api, Book, Decor, getBase, Verdict } from '@/api';
import Shelf3D from '@/components/Shelf3D';
import CollectionsView from '@/components/CollectionsView';
import { stars, VerdictBadge } from '@/components/FriendVerdicts';
import { colors, fonts } from '@/theme';

type Filter = 'all' | 'favourites' | 'reading' | 'tbr' | 'wishlist' | string;
type Gap = { title: string; index: number; collection: string; author: string };

export default function Library() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [books, setBooks] = useState<Book[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [arrange, setArrange] = useState(false);
  const [view, setView] = useState<'shelf' | 'collections' | 'grid'>('shelf');
  const [base, setBaseUrl] = useState('');
  React.useEffect(() => {
    getBase().then(setBaseUrl);
  }, []);
  const [error, setError] = useState('');

  const [gaps, setGaps] = useState<Gap[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict[]>>({});
  const [decor, setDecor] = useState<Decor[]>([]);
  const loadDecor = useCallback(() => api.decor().then(setDecor).catch(() => {}), []);
  const load = useCallback(async () => {
    try {
      const all = await api.books('all');
      loadDecor();
      setBooks(all);
      // friends' ratings for your books (wishlist + TBR first), keyed by title|author
      const want = all.filter((b) => b.status === 'wishlist' || b.tbr).concat(all.filter((b) => !(b.status === 'wishlist' || b.tbr)));
      api
        .friendVerdicts(want.slice(0, 300).map((b) => ({ title: b.title, author: b.author })))
        .then((r) => setVerdicts((cur) => ({ ...cur, ...Object.fromEntries(want.slice(0, 300).map((b, i) => [`${b.title}|${b.author}`, r.verdicts[i]]).filter(([, v]) => (v as Verdict[]).length)) })))
        .catch(() => {});
      // collection gaps ("to find") are wishes the Butler adds for you
      api
        .collections()
        .then((r) => {
          const gs: Gap[] = r.gaps.flatMap((g: any) => g.missing.map((m: any) => ({ ...m, collection: g.collection, author: g.author })));
          setGaps(gs);
          return api.friendVerdicts(gs.map((g) => ({ title: g.title, author: g.author }))).then((v) =>
            setVerdicts((cur) => ({ ...cur, ...Object.fromEntries(gs.map((g, i) => [`${g.title}|${g.author}`, v.verdicts[i]]).filter(([, x]) => (x as Verdict[]).length)) })),
          );
        })
        .catch(() => {});
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
    } else if (filter === 'tbr') {
      if (!b.tbr) return false;
    } else if (b.status !== 'owned') return false;
    if (filter === 'favourites' && !b.favourite) return false;
    if (filter === 'reading' && !b.reading) return false;
    if (!['all', 'favourites', 'reading', 'tbr', 'wishlist'].includes(filter) && b.collection !== filter) return false;
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
          <Pressable onPress={() => { tap(); router.push('/account'); }} hitSlop={8}>
            <Caps>{`${books.filter((b) => b.status === 'owned').length} volumes · friends →`}</Caps>
          </Pressable>
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
        {(['all', 'favourites', 'reading', 'tbr', 'wishlist'] as const).map((f) => (
          <Chip key={f} label={f === 'reading' ? 'Reading now' : f === 'tbr' ? 'To be read' : f} active={filter === f} onPress={() => setFilter(f)} />
        ))}
        {collections.map((c) => (
          <Chip key={c} label={c} active={filter === c} onPress={() => setFilter(c)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Italic style={{ fontSize: 15 }}>{arrange ? 'Hold and drag to rearrange your shelf.' : `${visible.length} shown`}</Italic>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          {!arrange && (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {(['shelf', 'collections', 'grid'] as const).map((v) => (
                <Pressable key={v} onPress={() => { tap(); setView(v); }} hitSlop={6}>
                  <Caps style={{ color: view === v ? colors.gold : colors.sepia }}>{v === 'shelf' ? 'Bookcase' : v === 'collections' ? 'Collections' : 'Gallery'}</Caps>
                </Pressable>
              ))}
            </View>
          )}
          {filter === 'all' && !q && (
            <Pressable onPress={() => { tap(); setArrange((a) => !a); }} hitSlop={8}>
              <Caps style={{ color: colors.ink }}>{arrange ? 'Done' : 'Arrange'}</Caps>
            </Pressable>
          )}
        </View>
      </View>
      <Rule />
      {filter === 'wishlist' && gaps.length > 0 && (
        <View style={{ paddingTop: 12 }}>
          <Caps style={{ color: colors.ink }}>{`To find · ${gaps.length} from your collections`}</Caps>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 10 }}>
            {gaps.map((g) => (
              <Pressable
                key={`${g.collection}${g.index}`}
                onPress={() => {
                  tap();
                  router.push({ pathname: '/pick', params: { title: g.title, author: g.author, stars: '4', reason: `Vol. ${g.index} of ${g.collection}, a series you collect` } });
                }}
                style={s.gap}
                accessibilityLabel={`To find: ${g.title}`}
              >
                <Text style={s.gapNum}>{g.index}</Text>
                <Text numberOfLines={3} style={s.gapTitle}>{g.title}</Text>
                <Caps style={{ fontSize: 7, color: colors.gold, marginTop: 4 }} numberOfLines={1}>{g.collection}</Caps>
                <VerdictBadge verdicts={verdicts[`${g.title}|${g.author}`]} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
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

  if (view === 'collections') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        {header}
        <CollectionsView books={books} />
      </View>
    );
  }

  // wishlist and TBR read best as a gallery (with friends' ratings under each cover)
  if (view === 'shelf' && base && !['wishlist', 'tbr'].includes(filter)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        {header}
        {visible.length > 0 ? (
          <Shelf3D books={visible} base={base} decor={filter === 'all' && !q ? decor : []} onDecorChange={loadDecor} onOpen={(id) => router.push(`/book/${id}`)} />
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
              {!!item.rating && <Text style={s.mine}>{`you ${stars(item.rating)}`}</Text>}
              {item.read_state === 'dnf' && <Text style={[s.mine, { color: '#D98B72' }]}>did not finish</Text>}
              <VerdictBadge verdicts={verdicts[`${item.title}|${item.author}`]} />
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
  mine: { fontFamily: fonts.body, fontSize: 10.5, color: colors.owned, marginTop: 3 },
  gap: { width: 74, height: 108, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(242,181,58,0.55)', alignItems: 'center', justifyContent: 'center', padding: 4 },
  gapNum: { fontFamily: fonts.displayLight, fontSize: 24, color: colors.gold },
  gapTitle: { fontFamily: fonts.bodyItalic, fontSize: 9.5, color: colors.inkSoft, textAlign: 'center' },
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
