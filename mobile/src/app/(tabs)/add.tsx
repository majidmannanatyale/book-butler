// Four ways to add a book: search, ISBN, photograph the copyright page
// (the Cataloguer agent reads it, then Open Library verifies), or by hand.
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import BookCover from '@/components/BookCover';
import GuidedCamera from '@/components/GuidedCamera';
import ImportPanel from '@/components/ImportPanel';
import { Button, Caps, Chip, Display, ErrorNote, Italic, Rule, tap } from '@/components/ui';
import { api, Draft, money, SearchHit } from '@/api';
import { colors, fonts } from '@/theme';

type Mode = 'camera' | 'search' | 'isbn' | 'import' | 'manual';

export default function Add() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('camera');
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 18, paddingHorizontal: 20, paddingBottom: 60 }}>
        <Caps>A new acquisition</Caps>
        <Display>Add a Book</Display>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 14 }}>
          <Chip label="Camera" active={mode === 'camera'} onPress={() => setMode('camera')} />
          <Chip label="Search" active={mode === 'search'} onPress={() => setMode('search')} />
          <Chip label="ISBN" active={mode === 'isbn'} onPress={() => setMode('isbn')} />
          <Chip label="Import" active={mode === 'import'} onPress={() => setMode('import')} />
          <Chip label="By hand" active={mode === 'manual'} onPress={() => setMode('manual')} />
        </ScrollView>
        <Rule style={{ marginBottom: 14 }} />
        {mode === 'search' && <SearchMode />}
        {mode === 'isbn' && <IsbnMode />}
        {mode === 'camera' && <CameraMode />}
        {mode === 'import' && <ImportPanel />}
        {mode === 'manual' && <DraftForm initial={{}} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ------------------------------------------------------------------ search

function ResultRow({ hit }: { hit: SearchHit }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'owned' | 'wishlist'>(hit.owned_id ? 'owned' : 'idle');
  const add = async (status: 'owned' | 'wishlist') => {
    setState('busy');
    try {
      await api.addBook({
        title: hit.title,
        author: hit.author,
        year: hit.year ?? null,
        pages: hit.pages ?? null,
        cover_url: hit.cover_url ?? null,
        subjects: hit.subjects,
        status,
        collection: hit.gap?.collection ?? null,
        series_index: hit.gap?.index ?? null,
      });
      setState(status);
    } catch {
      setState('idle');
    }
  };
  return (
    <View style={s.result}>
      <BookCover title={hit.title} author={hit.author} uri={hit.cover_url} width={52} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={s.resultTitle} numberOfLines={2}>
          {hit.title}
        </Text>
        <Italic style={{ fontSize: 14 }} numberOfLines={1}>
          {hit.author}
          {hit.year ? `, ${hit.year}` : ''}
        </Italic>
        {!!hit.gap && <Caps style={{ fontSize: 9, color: colors.gold, marginTop: 4 }}>{`Completes ${hit.gap.collection}`}</Caps>}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {state === 'owned' ? (
            <Caps style={{ color: colors.inkSoft }}>✓ In your library</Caps>
          ) : state === 'wishlist' ? (
            <Caps style={{ color: colors.inkSoft }}>♡ On your wishlist</Caps>
          ) : (
            <>
              <Button label="I own it" style={s.smallBtn} busy={state === 'busy'} onPress={() => add('owned')} />
              <Button label="Want" kind="outline" style={s.smallBtn} onPress={() => add('wishlist')} />
            </>
          )}
        </View>
      </View>
    </View>
  );
}

function SearchMode() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (q.trim().length < 2) return;
    tap();
    setBusy(true);
    setError('');
    try {
      setHits((await api.search(q)).results);
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };
  return (
    <View>
      <TextInput
        value={q}
        onChangeText={setQ}
        onSubmitEditing={go}
        returnKeyType="search"
        placeholder="Title, author, or both…"
        placeholderTextColor={colors.sepiaSoft}
        style={s.input}
        accessibilityLabel="Search Open Library"
      />
      <Button label="Search Open Library" onPress={go} busy={busy} style={{ marginTop: 12 }} />
      {!!error && <ErrorNote message={error} />}
      {hits.map((h, i) => (
        <Animated.View key={`${h.title}-${i}`} entering={FadeIn.delay(i * 60)}>
          <ResultRow hit={h} />
        </Animated.View>
      ))}
    </View>
  );
}

function IsbnMode() {
  const [isbn, setIsbn] = useState('');
  const [hit, setHit] = useState<SearchHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    tap();
    setBusy(true);
    setError('');
    setHit(null);
    try {
      setHit(await api.isbn(isbn));
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };
  return (
    <View>
      <TextInput
        value={isbn}
        onChangeText={setIsbn}
        onSubmitEditing={go}
        keyboardType="number-pad"
        placeholder="978…"
        placeholderTextColor={colors.sepiaSoft}
        style={s.input}
        accessibilityLabel="ISBN"
      />
      <Button label="Look it up" onPress={go} busy={busy} style={{ marginTop: 12 }} />
      {!!error && <ErrorNote message={error} />}
      {hit && <ResultRow hit={hit} />}
    </View>
  );
}

// ------------------------------------------------------------------- photo

function CameraMode() {
  const [result, setResult] = useState<null | { draft: Draft; verified: boolean; cost: number; shots: Record<string, { uri: string; b64: string }> }>(null);
  if (!result) return <GuidedCamera onRead={(r) => setResult(r as any)} />;
  const upload = async (id: number) => {
    for (const side of ['front', 'back', 'spine'] as const) {
      const shot = result.shots[side];
      if (shot) await api.uploadFace(id, side, shot.b64).catch(() => {});
    }
  };
  return (
    <View>
      <Italic style={{ marginBottom: 6 }}>
        {result.verified ? 'Read from your photos and confirmed with Open Library.' : 'Read from your photos — please check the details.'}
      </Italic>
      <Caps style={{ fontSize: 9, marginBottom: 10 }}>{`Cataloguer · ${Object.keys(result.shots).length} photos · ${money(result.cost)} · your photos become its 3D model`}</Caps>
      <DraftForm initial={result.draft} onSaved={upload} onDone={() => setResult(null)} />
    </View>
  );
}

function PhotoMode() {
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ draft: Draft; verified: boolean; cost: number } | null>(null);

  const shoot = async () => {
    if (!cam.current) return;
    tap();
    setBusy(true);
    setError('');
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.6, base64: true, shutterSound: false });
      const r = await api.catalogue(pic?.base64 || pic?.uri || '');
      setResult({ draft: r.draft, verified: r.verified, cost: r.usage.cost_usd });
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };

  if (result) {
    return (
      <View>
        <Italic style={{ marginBottom: 6 }}>
          {result.verified ? 'Read from your photo and confirmed with Open Library.' : 'Read from your photo — please check the details.'}
        </Italic>
        <Caps style={{ fontSize: 9, marginBottom: 10 }}>{`Cataloguer · ${money(result.cost)}`}</Caps>
        <DraftForm initial={result.draft} onDone={() => setResult(null)} />
      </View>
    );
  }

  return (
    <View>
      <Italic style={{ marginBottom: 12 }}>
        Photograph the copyright page (or the cover). The Cataloguer reads the edition details — handy for books without an ISBN.
      </Italic>
      {!permission?.granted ? (
        <Button label="Allow camera" onPress={requestPermission} />
      ) : focused ? (
        <View style={s.camWrap}>
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setReady(true)} />
        </View>
      ) : null}
      {permission?.granted && <Button label="Catalogue this page" onPress={shoot} busy={busy} disabled={!ready} style={{ marginTop: 12 }} />}
      {!!error && <ErrorNote message={error} />}
    </View>
  );
}

// ------------------------------------------------------------------ form

const FIELDS: [keyof Draft | 'height_cm' | 'pages', string][] = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['publisher', 'Publisher'],
  ['year', 'Year'],
  ['edition', 'Edition'],
  ['binding', 'Binding'],
  ['isbn', 'ISBN'],
  ['height_cm', 'Height (cm)'],
  ['pages', 'Pages'],
];

function DraftForm({ initial, onDone, onSaved }: { initial: Partial<Draft>; onDone?: () => void; onSaved?: (id: number) => Promise<void> }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map(([k]) => [k, (initial as any)[k] == null || (initial as any)[k] === 'unknown' ? '' : String((initial as any)[k])])),
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [dup, setDup] = useState<Awaited<ReturnType<typeof api.checkDuplicate>> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  // "Do I already own this?" — checked the moment the book is read, and again as details change
  useEffect(() => {
    if (!v.title?.trim()) return setDup(null);
    const t = setTimeout(() => {
      api
        .checkDuplicate({ title: v.title, author: v.author, isbn: v.isbn, edition: v.edition, binding: v.binding, publisher: v.publisher, year: Number(v.year) || null })
        .then((r) => {
          setDup(r.copies.length ? r : null);
          setConfirmed(false);
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [v.title, v.author, v.isbn, v.edition, v.binding, v.publisher, v.year]);
  const save = async (status: 'owned' | 'wishlist') => {
    if (!v.title?.trim()) {
      setNote('A title, at least.');
      return;
    }
    if (status === 'owned' && dup?.exact && !confirmed) {
      tap();
      setConfirmed(true);
      setNote('You already own this exact edition. Tap again to add another copy.');
      return;
    }
    setBusy(true);
    try {
      const num = (x: string) => (x.trim() === '' || isNaN(Number(x)) ? null : Number(x));
      const b = await api.addBook({
        title: v.title.trim(),
        author: v.author?.trim() || '',
        publisher: v.publisher || null,
        year: num(v.year),
        edition: v.edition || null,
        binding: v.binding || null,
        isbn: v.isbn || null,
        height_cm: num(v.height_cm),
        pages: num(v.pages),
        cover_url: initial.cover_url ?? null,
        subjects: initial.subjects ?? [],
        status,
      });
      setNote(b.possible_duplicate_of ? 'Added — you may already own a copy of this.' : 'Added to your library.');
      if (onSaved) {
        setNote('Saving your photos for the 3D model…');
        await onSaved(b.id);
      }
      onDone?.();
      router.push(`/book/${b.id}`);
    } catch (e: any) {
      setNote(e.message);
    }
    setBusy(false);
  };
  return (
    <View>
      {dup && (
        <Animated.View entering={FadeInDown.duration(350)} style={[s.dup, dup.exact && s.dupExact]}>
          <Caps style={{ color: dup.exact ? colors.paper : colors.gold }}>
            {dup.exact ? 'Already on your shelves' : `You own ${dup.owned === 1 ? 'another edition' : `${dup.owned} other editions`}`}
          </Caps>
          {dup.copies.slice(0, 3).map((c) => (
            <Pressable key={c.id} onPress={() => { tap(); router.push(`/book/${c.id}`); }} style={s.dupRow} accessibilityRole="button">
              <Text style={[s.dupText, dup.exact && { color: colors.paper }]} numberOfLines={1}>
                {`${c.title} · ${[c.edition, c.binding, c.year].filter(Boolean).join(', ') || 'edition unknown'}`}
              </Text>
              <Caps style={{ fontSize: 8, color: dup.exact ? colors.paper : colors.inkSoft }}>{`${c.status === 'wishlist' ? 'wishlist' : c.why} · open →`}</Caps>
            </Pressable>
          ))}
        </Animated.View>
      )}
      {FIELDS.map(([k, label]) => (
        <View key={k} style={{ marginBottom: 10 }}>
          <Caps style={{ fontSize: 9 }}>{label}</Caps>
          <TextInput
            value={v[k]}
            onChangeText={(t) => setV((d) => ({ ...d, [k]: t }))}
            keyboardType={['year', 'height_cm', 'pages'].includes(k) ? 'numeric' : 'default'}
            style={s.input}
            accessibilityLabel={label}
          />
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
        <Button label={dup?.exact ? (confirmed ? 'Add another copy' : 'Add anyway?') : 'Add to library'} style={{ flex: 1 }} busy={busy} onPress={() => save('owned')} />
        <Button label="Wishlist" kind="outline" style={{ flex: 0.7 }} onPress={() => save('wishlist')} />
      </View>
      {!!note && <Italic style={{ marginTop: 10 }}>{note}</Italic>}
    </View>
  );
}

const s = StyleSheet.create({
  dup: { borderWidth: 1, borderColor: 'rgba(242,181,58,0.6)', padding: 12, marginBottom: 14, gap: 6 },
  dupExact: { backgroundColor: colors.gold, borderColor: colors.gold },
  dupRow: { paddingVertical: 4 },
  dupText: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  input: {
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    fontFamily: fonts.body,
    fontSize: 17,
    color: colors.ink,
  },
  result: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  resultTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink, lineHeight: 22 },
  smallBtn: { minHeight: 34, paddingHorizontal: 12 },
  camWrap: { height: 360, backgroundColor: colors.wall, overflow: 'hidden' },
});
