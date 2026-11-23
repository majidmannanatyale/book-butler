// A single book, shown like a museum piece: dark wall, a spotlight, the book
// turning slowly on its plinth. Tap it to turn it over (the colophon is on the
// back). A placard beside it; every field can be edited.
import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { api, Book } from '@/api';
import { colors, fonts } from '@/theme';

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
  const [book, setBook] = useState<Book | null>(null);
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
    sway.value = withRepeat(withTiming(1, { duration: 4200, easing: Easing.inOut(Easing.sin) }), -1, true);
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
      {/* spotlight: a warm cone from above, feathered at the sides */}
      <LinearGradient
        colors={['rgba(255,232,190,0.15)', 'rgba(255,232,190,0.03)', 'rgba(0,0,0,0)']}
        locations={[0, 0.3, 0.55]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        colors={[colors.wall, 'rgba(20,21,19,0)', 'rgba(20,21,19,0)', colors.wall]}
        locations={[0, 0.3, 0.7, 1]}
        style={[StyleSheet.absoluteFill, { opacity: 0.85 }]}
      />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 60 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ paddingHorizontal: 14, paddingVertical: 6, alignSelf: 'flex-start' }} accessibilityLabel="Back">
          <IconBack color={colors.wallText} />
        </Pressable>
        {!!error && <ErrorNote dark message={error} />}
        {book && (
          <Animated.View entering={FadeIn.duration(700)}>
            {/* the piece */}
            <Pressable onPress={turn} accessibilityHint="Turns the book over" style={{ alignItems: 'center', height: 330, justifyContent: 'center', marginTop: 4 }}>
              <Animated.View style={[{ backfaceVisibility: 'hidden' }, front]}>
                <BookCover title={book.title} author={book.author} uri={book.cover_url} width={190} />
              </Animated.View>
              <Animated.View style={[{ position: 'absolute', backfaceVisibility: 'hidden' }, back]}>
                <View style={s.backCover}>
                  <Caps style={{ fontSize: 9, color: '#BDAF92' }}>Colophon</Caps>
                  <Text style={s.backText}>
                    {[book.publisher, book.year, book.binding, book.edition].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  {!!book.pages && <Text style={s.backText}>{book.pages} pages</Text>}
                  {!!book.height_cm && <Text style={s.backText}>{book.height_cm} cm tall</Text>}
                  {!!book.isbn && <Text style={s.backText}>ISBN {book.isbn}</Text>}
                  <Text style={[s.backText, { marginTop: 10, fontFamily: fonts.bodyItalic }]} numberOfLines={5}>
                    {(book.subjects || []).slice(0, 5).join(', ')}
                  </Text>
                </View>
              </Animated.View>
            </Pressable>
            {/* plinth */}
            <View style={s.plinth} />
            <Italic color={colors.wallMuted} style={{ textAlign: 'center', fontSize: 13, marginTop: 8 }}>
              tap the book to turn it over
            </Italic>

            {/* placard */}
            <View style={s.placard}>
              <Caps style={{ color: colors.sepia }}>{book.author}</Caps>
              <Text style={s.title}>{book.title}</Text>
              <Italic style={{ fontSize: 15 }}>
                {[book.year, book.edition, book.binding].filter(Boolean).join(', ')}
              </Italic>
              {!!book.collection && (
                <Caps style={{ marginTop: 10, fontSize: 9.5 }}>
                  {`${book.collection}${book.series_index ? ` · vol. ${book.series_index}` : ''}`}
                </Caps>
              )}
              {book.status === 'wishlist' && <Caps style={{ marginTop: 6, color: colors.gold }}>On your wishlist</Caps>}
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
