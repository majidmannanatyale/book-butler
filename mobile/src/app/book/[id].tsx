// A single book, shown like a museum piece: dark wall, a spotlight, the book
// turning slowly on its plinth. Tap it to turn it over (the colophon is on the
// back). A placard beside it; every field can be edited.
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import BookCover from '@/components/BookCover';
import { IconBack, IconHeart } from '@/components/Icons';
import { Button, Caps, ErrorNote, Italic, Ornament, Rule, tap } from '@/components/ui';
import { api, Book, bookCache, getBase } from '@/api';
import Book3D from '@/components/Book3D';
import SampleCard from '@/components/SampleCard';
import { colors, fonts } from '@/theme';

const MUSEUM_WALL = '#0B1110'; // the deep green-black of a gallery wall at night

const EDITABLE: [keyof Book, string, 'text' | 'number'][] = [
  ['title', 'Title', 'text'],
  ['author', 'Author', 'text'],
  ['year', 'Year', 'number'],
  ['publisher', 'Publisher', 'text'],
  ['edition', 'Edition', 'text'],
  ['binding', 'Binding', 'text'],
  ['height_cm', 'Height (cm)', 'number'],
  ['pages', 'Pages', 'number'],
  ['isbn', 'ISBN', 'text'],
  ['collection', 'Collection', 'text'],
  ['series_index', 'Volume no.', 'number'],
  ['hours_read', 'Hours read', 'number'],
  ['notes', 'Notes', 'text'],
];

export default function Showcase() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [book, setBook] = useState<Book | null>(() => bookCache.get(Number(id)) ?? null);
  const [settled, setSettled] = useState(false);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const sway = useSharedValue(0);
  const flip = useSharedValue(0);

  useEffect(() => {
    api
      .book(Number(id))
      .then(setBook)
      .catch((e) => setError(e.message));
    const h = setTimeout(() => setSettled(true), 380); // after the slide-in
    sway.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => clearTimeout(h);
  }, [id]);

  const front = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { rotateY: `${-16 + sway.value * 22 + flip.value * 180}deg` },
    ],
    opacity: interpolate(flip.value, [0.45, 0.55], [1, 0], 'clamp'),
  }));
  const back = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { rotateY: `${180 - 16 + sway.value * 22 + flip.value * 180}deg` },
    ],
    opacity: interpolate(flip.value, [0.45, 0.55], [0, 1], 'clamp'),
  }));

  const turn = () => {
    tap();
    flip.value = withSpring(flip.value > 0.5 ? 0 : 1, { damping: 14, stiffness: 70 });
  };

  const patch = async (changes: Partial<Book>) => {
    if (!book) return;
    try {
      setBook(await api.patchBook(book.id, changes));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const { height: screenH } = useWindowDimensions();
  const wallH = Math.max(420, screenH * 0.72);
  const unread = !!book && (book.status === 'wishlist' || (!book.reading && !(book.hours_read > 0) && !(book.progress > 0)));
  const [base, setBaseUrl] = useState('');
  useEffect(() => {
    getBase().then(setBaseUrl);
  }, []);

  const startEdit = () => {
    if (!book) return;
    tap();
    setDraft(Object.fromEntries(EDITABLE.map(([k]) => [k, book[k] == null ? '' : String(book[k])])));
    setEdit(true);
  };

  const saveEdit = async () => {
    if (!book) return;
    setSaving(true);
    const changes: any = {};
    for (const [k, , type] of EDITABLE) {
      const v = (draft[k as string] ?? '').trim();
      if (type === 'number') changes[k] = v === '' ? null : Number(v);
      else changes[k] = v === '' ? null : v;
    }
    if (!changes.title) changes.title = book.title;
    await patch(changes);
    setSaving(false);
    setEdit(false);
  };

  const remove = () => {
    if (!book) return;
    const go = async () => {
      await api.deleteBook(book.id).catch(() => {});
      router.back();
    };
    if (Platform.OS === 'web') {
      // eslint-disable-next-line no-alert
      if (window.confirm(`Remove “${book.title}” from your library?`)) go();
    } else {
      Alert.alert('Remove this book?', `“${book.title}” will leave your library.`, [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: go },
      ]);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.wall }}>
      {/* a museum wall at night: one soft pool of light on the piece, everything else falls away */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: MUSEUM_WALL }]} />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="pool" cx="42%" cy="30%" r="45%">
            <Stop offset="0" stopColor="#F2B53A" stopOpacity="0.09" />
            <Stop offset="0.6" stopColor="#0A1210" stopOpacity="0.02" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="vignette" cx="50%" cy="38%" r="75%">
            <Stop offset="0.55" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.55" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#pool)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vignette)" />
      </Svg>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 60 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start' }} accessibilityLabel="Back">
          <IconBack color={colors.wallText} />
        </Pressable>
        {!!error && <ErrorNote dark message={error} />}
        {book && (
          <Animated.View entering={FadeIn.duration(250)}>
            {/* the hang: one small piece on a large dark wall, with a museum label beside it */}
            <View style={{ height: wallH, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
              <View style={{ width: '58%' }}>
                {base && settled ? (
                  <Book3D book={book} base={base} height={Math.min(300, wallH * 0.62)} />
                ) : (
                  <View style={{ height: Math.min(300, wallH * 0.62), alignItems: 'center', justifyContent: 'center' }}>
                    <BookCover title={book.title} author={book.author} uri={book.cover_url} width={Math.min(300, wallH * 0.62) / 1.5} />
                  </View>
                )}
              </View>
              <Animated.View entering={FadeIn.delay(600).duration(900)} style={s.label}>
                <Text style={s.labelArtist}>{(book.author || 'Unknown').toUpperCase()}</Text>
                {!!book.year && <Text style={s.labelSmall}>{`${book.year}${book.publisher ? ` · ${book.publisher}` : ''}`}</Text>}
                <Text style={s.labelTitle}>{book.title}</Text>
                <Text style={s.labelSmall}>{[book.binding, book.edition].filter(Boolean).join(', ') || 'Bound volume'}</Text>
                <Text style={[s.labelSmall, { marginTop: 6, opacity: 0.6 }]}>
                  {[book.height_cm ? `${book.height_cm} cm` : '', book.pages ? `${book.pages} pp.` : '', book.collection || ''].filter(Boolean).join(' | ')}
                </Text>
                <Text style={[s.labelSmall, { marginTop: 6, opacity: 0.5 }]}>
                  {book.status === 'wishlist' ? 'Wanted · not yet acquired' : `In the collection${book.reading ? ' · now reading' : ''}`}
                </Text>
              </Animated.View>
            </View>
            <Italic color={colors.wallMuted} style={{ textAlign: 'center', fontSize: 12, opacity: 0.6, marginTop: -16 }}>
              {['front', 'back', 'spine'].every((f) => (book.faces || []).includes(f))
                ? 'drag the book to turn it all the way around'
                : 'photograph its front, back and spine (Add → Camera) to turn it in 3D'}
            </Italic>
            <View style={{ alignItems: 'center', marginTop: 18 }}>
              <Caps color={colors.wallMuted} style={{ fontSize: 8.5, opacity: 0.5 }}>scroll for details</Caps>
            </View>

            {/* placard */}
            <View style={s.placard}>
              <Caps style={{ color: colors.sepia }}>About this volume</Caps>
              {!!book.collection && (
                <Caps style={{ marginTop: 10, fontSize: 9.5 }}>
                  {`${book.collection}${book.series_index ? ` · vol. ${book.series_index}` : ''}`}
                </Caps>
              )}
              {book.status === 'wishlist' && <Caps style={{ marginTop: 6, color: colors.gold }}>On your wishlist</Caps>}
              <Text style={s.meta}>
                {[book.publisher, book.pages ? `${book.pages} pages` : '', book.height_cm ? `${book.height_cm} cm` : '', book.isbn ? `ISBN ${book.isbn}` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {unread && <SampleCard dark={false} load={() => api.sampleForBook(book.id)} />}
              <Ornament />
              <View style={s.actions}>
                <Pressable onPress={() => { tap(); patch({ favourite: !book.favourite }); }} style={s.action} accessibilityLabel="Favourite">
                  <IconHeart color={colors.gold} filled={book.favourite} />
                  <Caps style={{ fontSize: 9 }}>{book.favourite ? 'Favourite' : 'Favour'}</Caps>
                </Pressable>
                <Pressable onPress={() => { tap(); patch({ reading: !book.reading }); }} style={s.action} accessibilityLabel="Currently reading">
                  <Text style={{ fontSize: 18, color: book.reading ? colors.gold : colors.sepia }}>❧</Text>
                  <Caps style={{ fontSize: 9 }}>{book.reading ? 'Reading' : 'Start'}</Caps>
                </Pressable>
                {book.status === 'wishlist' ? (
                  <Pressable onPress={() => { tap(); patch({ status: 'owned' }); }} style={s.action}>
                    <Text style={{ fontSize: 18, color: colors.sepia }}>✓</Text>
                    <Caps style={{ fontSize: 9 }}>Got it</Caps>
                  </Pressable>
                ) : null}
              </View>
              {book.reading && (
                <View style={{ marginTop: 14 }}>
                  <Caps style={{ fontSize: 9 }}>{`Progress · ${Math.round(book.progress * 100)}%`}</Caps>
                  <View style={s.progressRow}>
                    {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                      <Pressable key={p} onPress={() => { tap(); patch({ progress: p }); }} style={[s.progressStep, book.progress >= p && p > 0 && { backgroundColor: colors.gold }]} accessibilityLabel={`${p * 100}%`} />
                    ))}
                  </View>
                </View>
              )}

              {edit ? (
                <View style={{ marginTop: 16 }}>
                  {EDITABLE.map(([k, label, type]) => (
                    <View key={k as string} style={{ marginBottom: 10 }}>
                      <Caps style={{ fontSize: 9 }}>{label}</Caps>
                      <TextInput
                        value={draft[k as string]}
                        onChangeText={(v) => setDraft((d) => ({ ...d, [k as string]: v }))}
                        keyboardType={type === 'number' ? 'numeric' : 'default'}
                        style={s.input}
                        accessibilityLabel={label}
                      />
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                    <Button label="Cancel" kind="outline" style={{ flex: 1 }} onPress={() => setEdit(false)} />
                    <Button label="Save" style={{ flex: 1 }} busy={saving} onPress={saveEdit} />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                  <Button label="Edit details" kind="outline" style={{ flex: 1 }} onPress={startEdit} />
                  <Button label="Remove" kind="ghost" style={{ flex: 0.6 }} onPress={remove} />
                </View>
              )}
              {!!book.notes && !edit && (
                <>
                  <Rule style={{ marginVertical: 14 }} />
                  <Italic style={{ fontSize: 15 }}>{book.notes}</Italic>
                </>
              )}
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  backCover: {
    width: 190,
    height: 285,
    backgroundColor: '#2B2620',
    borderWidth: 1,
    borderColor: 'rgba(201,168,106,0.5)',
    padding: 18,
    justifyContent: 'center',
  },
  backText: { fontFamily: fonts.body, color: '#E2D7BF', fontSize: 13, marginTop: 4, lineHeight: 18 },
  plinth: {
    alignSelf: 'center',
    width: 230,
    height: 10,
    backgroundColor: '#2A2B27',
    borderTopWidth: 1,
    borderColor: 'rgba(233,225,207,0.18)',
    marginTop: -6,
  },
  meta: { fontFamily: fonts.body, fontSize: 13.5, color: colors.sepia, marginTop: 8 },
  label: { width: '40%', paddingLeft: 6 },
  labelArtist: { fontFamily: fonts.bodyMedium, fontSize: 10.5, letterSpacing: 1.4, color: '#D9D2C2' },
  labelTitle: { fontFamily: fonts.bodyMedium, fontSize: 12, color: '#E9E3D6', marginTop: 6 },
  labelSmall: { fontFamily: fonts.body, fontSize: 9.5, color: '#A9A396', marginTop: 2, lineHeight: 13 },
  placard: { backgroundColor: colors.paperDeep, marginHorizontal: 20, marginTop: 26, padding: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(242,181,58,0.45)' },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink, lineHeight: 34, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-around' },
  action: { alignItems: 'center', gap: 4, minWidth: 70, paddingVertical: 4 },
  progressRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  progressStep: { flex: 1, height: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.sepia },
  input: {
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 6,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
});
