// The Book Finder — point at a shelf, and the shelf becomes an exhibition.
//
// 1. Camera (or a sample shelf).  2. "Reading the spines" — a lamp sweeps the photo.
// 3. The photo hangs in a gilt frame on a dark wall; everything dims except the
//    books that matter: your picks (gilt frames + Roman numerals), books that
//    complete a collection (◆), books you own (✓), and booby-trapped spines (!).
//    Placards below tell the story; tap a marker or a placard to light it up.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';

import Stars from '@/components/Stars';
import { Button, Caps, Chip, ErrorNote, Italic, tap } from '@/components/ui';
import { IconClose } from '@/components/Icons';
import { api, Box, money, ScanResult, SpottedBook, tokens } from '@/api';
import { refineWithOcr } from '@/refine';
import SpineLight from '@/components/SpineLight';
import SessionFinder from '@/components/SessionFinder';
import { onDeviceAvailable, readShelf } from '@/ondevice';
import { colors, fonts, ROMAN } from '@/theme';

type Phase = 'camera' | 'scanning' | 'result' | 'error';
type Filter = 'all' | 'pick' | 'missing' | 'owned';

const STATUS_LINES = [
  'Reading the spines…',
  'Consulting your library…',
  'Checking your collections…',
  'Asking the curator…',
  'Hanging the exhibition…',
];

// Phone build: the recording session (on-device reading + parallel Scout agents).
// Web / Expo Go: the photo flow (AI reads the photo on the server).
export default function Finder() {
  const [mode, setMode] = useState<'session' | 'photo'>('session');
  if (onDeviceAvailable() && mode === 'session') return <SessionFinder onSnapshot={() => setMode('photo')} />;
  return <PhotoFinder onSession={onDeviceAvailable() ? () => setMode('session') : undefined} />;
}

function PhotoFinder({ onSession }: { onSession?: () => void }) {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('camera');
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  /** Tap-to-freeze: ML Kit on the phone (all directions) -> library match -> Curator picks. */
  const freezeAndRead = async (picUri: string) => {
    const t0 = Date.now();
    setPhoto(picUri);
    setPhase('scanning');
    setError('');
    setProgress('Reading the spines…');
    try {
      const ocr = await readShelf(picUri);
      if (__DEV__ && ocr.b64) api.debugOcr(ocr.b64, ocr.blocks, ocr.raw).catch(() => {});
      const zero = { model: 'gpt-6-luna', input_tokens: 0, cached_tokens: 0, output_tokens: 0, requests: 0, cost_usd: 0 };
      let books: SpottedBook[] = ocr.blocks.map((b, i) => ({
        id: i,
        title: b.text,
        author: '',
        box: { x: b.x, y: b.y, w: b.w, h: b.h },
        angle: b.angle,
        len: b.len,
        confidence: 1,
        status: 'candidate',
      }));
      const show = (usage = zero, done = false) =>
        setResult({
          books,
          counts: {},
          notes: '',
          image: { w: ocr.w, h: ocr.h, dhash: '' },
          usage,
          cached: false,
          seconds: Math.round((Date.now() - t0) / 100) / 10,
          timings: { read: ocr.ms / 1000 },
          ...(done ? {} : { progress: true }),
        } as any);
      setPhoto(ocr.uri); // the exact pixels ML Kit read
      show();
      setPhase('result');
      if (!books.length) {
        setProgress('');
        setError('No readable spines — try a little closer, with more light.');
        setPhase('error');
        return;
      }
      // phase 1: library match (plain code, ~0.2 s)
      setProgress('Checking your library…');
      const blocks = ocr.blocks.map((b, i) => ({ id: i, text: b.text }));
      const m = await api.liveMatch(blocks);
      books = books.map((b, i) => {
        const r = m.books[i];
        if (!r || r.status === 'unknown') return b;
        return { ...b, status: r.status, title: r.title || b.title, author: r.author || '', note: r.note, book_id: r.book_id, collection: r.collection };
      });
      show();
      // phase 2: picks for the spines your library doesn't know (~3 s)
      const unknown = books.filter((b) => b.status === 'candidate').map((b) => ({ id: b.id, text: b.title }));
      let usage = zero;
      if (unknown.length) {
        setProgress('Asking the curator…');
        const r = await api.liveIdentify(unknown);
        usage = r.usage;
        const picks = new Map<number, any>(r.books.map((x: any) => [x.id, x]));
        books = books.map((b) => {
          const pk = picks.get(b.id);
          return pk
            ? { ...b, status: 'pick', title: pk.title, author: pk.author, stars: pk.stars, note: pk.note, cover_url: pk.cover_url, year: pk.year }
            : b;
        });
      }
      show(usage, true);
      setProgress('');
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
      setPhase('error');
    }
  };

  const run = async (uri: string, job: () => Promise<ScanResult>) => {
    setPhoto(uri);
    setPhase('scanning');
    setError('');
    try {
      const r = await job();
      setResult(r);
      setPhase('result');
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
      setPhase('error');
    }
  };

  const capture = async () => {
    if (!cam.current) return;
    tap();
    try {
      if (onDeviceAvailable()) {
        const pic = await cam.current.takePictureAsync({ quality: 0.7, shutterSound: false });
        if (pic?.uri) freezeAndRead(pic.uri);
        return;
      }
      const pic = await cam.current.takePictureAsync({ quality: 0.55, base64: true, shutterSound: false });
      if (!pic) return;
      const b64 = pic.base64 || pic.uri; // on web the uri *is* the base64 data URL
      const uri = pic.uri;
      // AI decides WHAT is on the shelf; on-device ML Kit then snaps each box to where the text really is.
      run(uri, async () => refineWithOcr(await api.scan(b64), uri, pic.width, pic.height));
    } catch (e: any) {
      setError(e?.message || 'Could not take the photo.');
      setPhase('error');
    }
  };

  const sample = async (name: 'bookshop' | 'injection') => {
    tap();
    const url = await api.sampleUrl(name);
    run(url, () => api.scanSample(name));
  };

  const reset = () => {
    tap();
    setPhase('camera');
    setResult(null);
    setPhoto(null);
  };

  if (phase === 'result' && result && photo) {
    return <Exhibit result={result} photo={photo} onClose={reset} progress={progress} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.wall }}>
      {phase === 'camera' && focused && permission?.granted ? (
        <CameraView
          ref={cam}
          style={StyleSheet.absoluteFill}
          facing="back"
          onCameraReady={() => setReady(true)}
          onMountError={(e) => setError(e.message)}
        />
      ) : null}
      {(phase === 'scanning' || phase === 'error') && photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} contentFit="contain" />
      ) : null}

      {/* gallery vignette + framing corners */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(10,10,9,0.75)', 'rgba(10,10,9,0)', 'rgba(10,10,9,0)', 'rgba(10,10,9,0.85)']}
        locations={[0, 0.22, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
      {phase === 'camera' && <Corners />}
      {phase === 'camera' && permission?.granted && (
        <Pressable accessibilityLabel="Tap to read this shelf" onPress={capture} disabled={!ready} style={StyleSheet.absoluteFill} />
      )}
      {phase === 'scanning' && <LampSweep />}

      <View style={{ paddingTop: insets.top + 18, alignItems: 'center', paddingHorizontal: 24 }}>
        <Caps color={colors.wallMuted}>The Book Finder</Caps>
        <Italic color={colors.wallText} style={{ fontSize: 20, marginTop: 6, textAlign: 'center' }}>
          {phase === 'scanning' ? <StatusLine /> : 'Frame a shelf, then tap anywhere.'}
        </Italic>
      </View>

      <View style={{ flex: 1 }} />

      <View style={{ paddingBottom: 26, alignItems: 'center', gap: 16, paddingHorizontal: 24 }}>
        {phase === 'error' && <ErrorNote dark message={error} />}
        {phase === 'camera' && !permission?.granted && (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <Italic color={colors.wallMuted} style={{ textAlign: 'center' }}>
              The finder needs the camera to see the shelf.
            </Italic>
            {permission?.canAskAgain !== false && <Button dark label="Allow camera" onPress={requestPermission} />}
          </View>
        )}
        {phase === 'camera' && permission?.granted && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan this shelf"
            disabled={!ready}
            onPress={capture}
            style={({ pressed }) => [s.shutter, { opacity: ready ? (pressed ? 0.7 : 1) : 0.4 }]}
          >
            <View style={s.shutterInner} />
          </Pressable>
        )}
        {phase === 'error' && <Button dark kind="outline" label="Try again" onPress={reset} />}
        {phase !== 'scanning' && (
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Caps color={colors.wallMuted} style={{ fontSize: 9.5 }}>
              No shelf nearby?
            </Caps>
            <Chip dark label="Sample shelf" onPress={() => sample('bookshop')} />
            <Chip dark label="Safety test" onPress={() => sample('injection')} />
            {onSession && <Chip dark label="Recording mode" onPress={onSession} />}
          </View>
        )}
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ pieces

function Corners() {
  const c = 'rgba(233,225,207,0.75)';
  const L = 26;
  const corner = (pos: object, d: object) => <View style={[s.corner, pos, d, { borderColor: c, width: L, height: L }]} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { margin: 34, marginTop: 120, marginBottom: 190 }]}>
      {corner({ top: 0, left: 0 }, { borderTopWidth: 1, borderLeftWidth: 1 })}
      {corner({ top: 0, right: 0 }, { borderTopWidth: 1, borderRightWidth: 1 })}
      {corner({ bottom: 0, left: 0 }, { borderBottomWidth: 1, borderLeftWidth: 1 })}
      {corner({ bottom: 0, right: 0 }, { borderBottomWidth: 1, borderRightWidth: 1 })}
    </View>
  );
}

function LampSweep() {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: -width * 0.35 + x.value * width * 1.1 }] }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, st]}>
      <LinearGradient
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        colors={['rgba(255,228,170,0)', 'rgba(255,228,170,0.22)', 'rgba(255,228,170,0)']}
        style={{ width: width * 0.35, height: '100%' }}
      />
    </Animated.View>
  );
}

function StatusLine() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => Math.min(n + 1, STATUS_LINES.length - 1)), 1700);
    return () => clearInterval(t);
  }, []);
  return <Text>{STATUS_LINES[i]}</Text>;
}

// --------------------------------------------------------------- the exhibit

function clamp(b: Box): Box {
  const x = Math.max(0, Math.min(1, b.x));
  const y = Math.max(0, Math.min(1, b.y));
  return { x, y, w: Math.max(0.01, Math.min(1 - x, b.w)), h: Math.max(0.01, Math.min(1 - y, b.h)) };
}

const STYLE: Record<string, { stroke: string; dash?: string; badge: string; label: string }> = {
  pick: { stroke: colors.goldBright, badge: colors.goldBright, label: 'Pick for you' },
  missing: { stroke: colors.missing, dash: '6,4', badge: colors.missing, label: 'Completes a collection' },
  owned: { stroke: colors.owned, badge: colors.owned, label: 'In your library' },
  flagged: { stroke: colors.flagged, dash: '3,3', badge: colors.flagged, label: 'Ignored — suspicious text' },
  candidate: { stroke: 'rgba(169,205,190,0.55)', dash: '2,4', badge: colors.sepia, label: 'On the shelf' },
};

function Exhibit({ result, photo, onClose, progress = '' }: { result: ScanResult; photo: string; onClose: () => void; progress?: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<number | null>(null);
  const [books, setBooks] = useState<SpottedBook[]>(result.books);
  useEffect(() => setBooks(result.books), [result.books]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    books.forEach((b) => (c[b.status] = (c[b.status] || 0) + 1));
    return c;
  }, [books]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const list = useRef<FlatList<SpottedBook>>(null);

  // Rank picks by stars → Roman numerals I..V
  const rank = useMemo(() => {
    const picks = books.filter((b) => b.status === 'pick').sort((a, b) => (b.stars || 0) - (a.stars || 0));
    const m: Record<number, string> = {};
    picks.forEach((b, i) => (m[b.id] = ROMAN[i]));
    return m;
  }, [books]);

  const shown = books.filter((b) => {
    if (!STYLE[b.status]) return false;
    if (filter === 'all') return true;
    return b.status === filter;
  });
  const placards = shown.filter((b) => b.status !== 'candidate').sort((a, b) => order(a) - order(b) || (b.stars || 0) - (a.stars || 0));

  // Fit the photo (as a framed painting) into the space above the placards.
  // fit the framed photo inside the space actually left for it (measured)
  const [area, setArea] = useState({ w: width - 28, h: Math.max(160, height * 0.32) });
  const availW = Math.min(area.w, width - 28) - 22;
  const availH = area.h - 26;
  const aspect = result.image.w / result.image.h;
  let fw = availW;
  let fh = fw / aspect;
  if (fh > availH) {
    fh = availH;
    fw = fh * aspect;
  }

  const select = (b: SpottedBook) => {
    tap();
    setSelected(b.id);
    const idx = placards.findIndex((p) => p.id === b.id);
    if (idx >= 0) list.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
  };

  const save = async (b: SpottedBook, status: 'owned' | 'wishlist') => {
    tap();
    setBusyId(b.id);
    try {
      const added = await api.addBook({
        title: b.title,
        author: b.author,
        status,
        year: b.year ?? null,
        cover_url: b.cover_url ?? null,
        subjects: b.subjects ?? [],
        collection: b.collection ?? null,
      });
      setBooks((all) =>
        all.map((x) =>
          x.id === b.id
            ? status === 'owned'
              ? { ...x, status: 'owned', book_id: added.id, note: 'Just added to your library' }
              : { ...x, note: `${x.note ? x.note + ' · ' : ''}On your wishlist`, book_id: added.id }
            : x,
        ),
      );
    } catch {}
    setBusyId(null);
  };

  const u = result.usage;

  return (
    <View style={{ flex: 1, backgroundColor: colors.wall }}>
      {/* soft spotlight from above, like a gallery lamp */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,236,200,0.10)', 'rgba(255,236,200,0)']}
        style={[StyleSheet.absoluteFill, { height: height * 0.6 }]}
      />
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onClose} accessibilityLabel="Close and scan again" hitSlop={12} style={{ padding: 6 }}>
          <IconClose color={colors.wallText} />
        </Pressable>
        <View style={{ alignItems: 'center' }}>
          <Caps color={colors.wallMuted}>The exhibition</Caps>
          <Italic color={colors.wallText} style={{ fontSize: 16 }}>
            {progress || summary(counts)}
          </Italic>
          <Caps color={colors.wallMuted} style={{ textAlign: 'center', fontSize: 9, marginTop: 2 }}>
        {result.cached
          ? `Seen before · from cache · $0.00 · saved ${money(u.saved_usd || 0)}`
          : `${books.length} spines · ${result.seconds}s · ${tokens(u.input_tokens + u.output_tokens)} tokens · ${money(u.cost_usd)}`}
      </Caps>
        </View>
        <View style={{ width: 34 }} />
      </View>

      {/* The framed photo with the overlay */}
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
        onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      >
        <View style={[s.frameOuter, { width: fw + 18, height: fh + 18 }]}>
          <View style={[s.frameInner, { width: fw + 6, height: fh + 6 }]}>
            <View style={{ width: fw, height: fh }}>
              <Image source={{ uri: photo }} style={{ width: fw, height: fh }} contentFit="fill" />
              <LinearGradient
                pointerEvents="none"
                colors={['rgba(5,13,26,0.5)', 'rgba(5,13,26,0.25)', 'rgba(5,13,26,0.5)']}
                style={StyleSheet.absoluteFill}
              />
              {shown.map((b, i) => {
                if (b.status === 'candidate' || !STYLE[b.status]) return null; // only books that matter get light
                const bx = clamp(b.box);
                return (
                  <SpineLight
                    key={b.id}
                    kind={b.status as any}
                    cx={(bx.x + bx.w / 2) * fw}
                    cy={(bx.y + bx.h / 2) * fh}
                    height={Math.min(fh * 0.95, ((b as any).len ?? bx.h) * fh * 1.6)}
                    angle={(b as any).angle ?? 0}
                    label={b.status === 'pick' ? rank[b.id] : undefined}
                    selected={selected === b.id}
                    delay={200 + i * 70}
                    onPress={() => select(b)}
                    accessibilityLabel={`${STYLE[b.status].label}: ${b.title}`}
                  />
                );
              })}
            </View>
          </View>
        </View>
      </View>

      {/* filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginTop: 10 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
        <Chip dark label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip dark label={`Picks · ${counts.pick || 0}`} active={filter === 'pick'} onPress={() => setFilter('pick')} />
        <Chip dark label={`To complete · ${counts.missing || 0}`} active={filter === 'missing'} onPress={() => setFilter('missing')} />
        <Chip dark label={`Owned · ${counts.owned || 0}`} active={filter === 'owned'} onPress={() => setFilter('owned')} />
      </ScrollView>

      {/* placards */}
      <FlatList
        ref={list}
        horizontal
        style={{ flexGrow: 0, flexShrink: 0 }}
        data={placards}
        keyExtractor={(b) => String(b.id)}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingVertical: 12 }}
        onScrollToIndexFailed={() => {}}
        ListEmptyComponent={
          progress ? (
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <PlacardSkeleton key={i} delay={i * 180} label={i === 0 ? progress : ''} />
              ))}
            </View>
          ) : (
            <Italic color={colors.wallMuted} style={{ paddingVertical: 30 }}>
              Nothing to show here — try another filter or another shelf.
            </Italic>
          )
        }
        renderItem={({ item: b, index }) => (
          <Animated.View entering={FadeInDown.delay(400 + index * 70).duration(500)}>
            <Pressable onPress={() => select(b)} style={[s.placard, selected === b.id && s.placardOn]}>
              <Caps style={{ fontSize: 9, color: b.status === 'pick' ? '#B07A12' : colors.creamSoft }}>
                {b.status === 'pick' ? `${STYLE.pick.label} · ${rank[b.id]}` : STYLE[b.status].label}
              </Caps>
              <Text numberOfLines={2} style={s.placardTitle}>
                {b.title}
              </Text>
              {!!b.author && (
                <Italic numberOfLines={1} style={{ fontSize: 14, color: colors.creamSoft }}>
                  {b.author}
                  {b.year ? `, ${b.year}` : ''}
                </Italic>
              )}
              {b.status === 'pick' && !!b.stars && (
                <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Stars n={b.stars} onCream />
                  <Pressable
                    hitSlop={8}
                    onPress={() => router.push({ pathname: '/pick', params: { title: b.title, author: b.author || '', stars: String(b.stars || 3), reason: b.note || '', cover: b.cover_url || '' } })}
                  >
                    <Caps style={{ fontSize: 9, color: '#B07A12' }}>Why? →</Caps>
                  </Pressable>
                </View>
              )}
              {!!b.note && (
                <Text numberOfLines={3} style={s.placardNote}>
                  {b.note}
                </Text>
              )}
              <View style={{ flex: 1 }} />
              {(b.status === 'pick' || b.status === 'missing') && !b.book_id && (
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                  <Button cream label="Want" kind="outline" style={s.smallBtn} busy={busyId === b.id} onPress={() => save(b, 'wishlist')} />
                  <Button cream label="Own it" style={s.smallBtn} busy={busyId === b.id} onPress={() => save(b, 'owned')} />
                </View>
              )}
              {b.status === 'owned' && b.book_id && (
                <Button cream label="View" kind="outline" style={[s.smallBtn, { marginTop: 10 }]} onPress={() => router.push(`/book/${b.book_id}`)} />
              )}
            </Pressable>
          </Animated.View>
        )}
      />

      <View style={{ height: 34 }} />
    </View>
  );
}

function Overlay({ books, fw, fh, selected }: { books: SpottedBook[]; fw: number; fh: number; selected: number | null }) {
  const glow = useSharedValue(0.4);
  useEffect(() => {
    glow.value = withRepeat(withSequence(withTiming(1, { duration: 900 }), withTiming(0.4, { duration: 900 })), -1);
  }, []);
  const lit = books.filter((b) => b.status !== 'owned' || selected === b.id);
  return (
    <Animated.View entering={FadeIn.duration(700)} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={fw} height={fh}>
        <Defs>
          <Mask id="lit" x="0" y="0" width={fw} height={fh} maskUnits="userSpaceOnUse">
            <Rect x="0" y="0" width={fw} height={fh} fill="white" />
            {lit.map((b) => {
              const x = clamp(b.box);
              return <Rect key={b.id} x={x.x * fw - 2} y={x.y * fh - 2} width={x.w * fw + 4} height={x.h * fh + 4} fill="black" />;
            })}
          </Mask>
        </Defs>
        {/* the dimmed gallery */}
        <Rect x="0" y="0" width={fw} height={fh} fill="rgba(8,8,7,0.66)" mask="url(#lit)" />
        {/* owned books stay softly visible */}
        {books
          .filter((b) => b.status === 'owned' && selected !== b.id)
          .map((b) => {
            const x = clamp(b.box);
            return <Rect key={`o${b.id}`} x={x.x * fw} y={x.y * fh} width={x.w * fw} height={x.h * fh} fill="rgba(8,8,7,0.25)" />;
          })}
        {/* frames */}
        {books.map((b) => {
          const x = clamp(b.box);
          const st = STYLE[b.status];
          const on = selected === b.id;
          return (
            <React.Fragment key={`f${b.id}`}>
              <Rect
                x={x.x * fw}
                y={x.y * fh}
                width={x.w * fw}
                height={x.h * fh}
                fill="none"
                stroke={st.stroke}
                strokeWidth={on ? 2.2 : b.status === 'pick' ? 1.6 : 1}
                strokeDasharray={st.dash}
                opacity={b.status === 'owned' && !on ? 0.6 : 1}
              />
              {b.status === 'pick' && (
                <Rect
                  x={x.x * fw + 3}
                  y={x.y * fh + 3}
                  width={Math.max(1, x.w * fw - 6)}
                  height={Math.max(1, x.h * fh - 6)}
                  fill="none"
                  stroke={st.stroke}
                  strokeWidth={0.6}
                  opacity={0.7}
                />
              )}
            </React.Fragment>
          );
        })}
      </Svg>
    </Animated.View>
  );
}

/** A placeholder placard that gently shimmers while the curator is working. */
function PlacardSkeleton({ delay, label }: { delay: number; label: string }) {
  const o = useSharedValue(0.35);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(0.75, { duration: 900 }), withTiming(0.35, { duration: 900 })), -1);
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View entering={FadeIn.delay(delay)} style={[s.placard, { backgroundColor: 'rgba(244,236,221,0.10)' }, st]}>
      <View style={{ height: 9, width: 90, backgroundColor: 'rgba(242,181,58,0.5)' }} />
      <View style={{ height: 18, width: 150, backgroundColor: 'rgba(244,236,221,0.35)', marginTop: 12 }} />
      <View style={{ height: 12, width: 110, backgroundColor: 'rgba(244,236,221,0.25)', marginTop: 8 }} />
      {!!label && <Italic color={colors.wallText} style={{ fontSize: 14, marginTop: 18 }}>{label}</Italic>}
    </Animated.View>
  );
}

function order(b: SpottedBook) {
  return { pick: 0, missing: 1, flagged: 2, owned: 3, candidate: 4 }[b.status as string] ?? 9;
}

function summary(c: Record<string, number>) {
  const parts = [];
  if (c.pick) parts.push(`${c.pick} for you`);
  if (c.missing) parts.push(`${c.missing} to complete`);
  if (c.owned) parts.push(`${c.owned} already yours`);
  return parts.join(' · ') || 'Nothing recognised on this shelf';
}

const s = StyleSheet.create({
  corner: { position: 'absolute' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    borderColor: colors.goldBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.wallText },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  frameOuter: {
    backgroundColor: '#8A6B3A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C9A86A',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  frameInner: { backgroundColor: '#2A2116', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#5E4824' },
  marker: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    backgroundColor: 'rgba(5,13,26,0.85)',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  placard: {
    width: 224,
    minHeight: 232,
    backgroundColor: colors.cream,
    padding: 14,
    borderRadius: 1,
  },
  placardOn: { borderWidth: 2, borderColor: colors.gold },
  placardTitle: { fontFamily: fonts.display, fontSize: 20, color: colors.creamInk, marginTop: 6, lineHeight: 23 },
  placardNote: { fontFamily: fonts.bodyItalic, fontSize: 13.5, color: colors.creamSoft, marginTop: 6, lineHeight: 18 },
  smallBtn: { minHeight: 34, paddingHorizontal: 10, flex: 1 },
});
