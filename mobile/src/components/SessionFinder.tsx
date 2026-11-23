// Recording-session Book Finder.
//
// Press record and sweep along the shelves. About once a second the phone reads
// a frame ON THE DEVICE (ML Kit); every new spine is matched against your library
// in ~0.2 s, and the unknown ones are fanned out to a team of Scout agents that
// run in parallel on the server (≈ one AI call of latency, ~2.5 s). Books appear
// in the list as they're found; a ring shows how much of what you've swept has
// been identified. Stop to see the summary.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useIsFocused, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeInDown,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';

import Stars from '@/components/Stars';
import { Button, Caps, Chip, ErrorNote, Italic, tap } from '@/components/ui';
import { api, money } from '@/api';
import { readShelf } from '@/ondevice';
import { colors, fonts } from '@/theme';
import Tip from '@/components/Tip';

type Status = 'reading' | 'scouting' | 'owned' | 'missing' | 'pick' | 'book' | 'noise' | 'flagged';
type Found = {
  key: string;
  text: string;
  tokens: Set<string>;
  status: Status;
  title?: string;
  author?: string;
  stars?: number;
  note?: string;
  bookId?: number;
  order: number;
  saved?: 'owned' | 'wishlist';
  collectible?: boolean;
  collectibleWhy?: string;
  priceSeen?: string;
  friendsOwn?: string[];
};

const words = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

const DONE: Status[] = ['owned', 'missing', 'pick', 'book', 'noise', 'flagged'];

/** Same book? (titles from different frames / different OCR blocks) */
const tnorm = (t?: string) => (t || '').toLowerCase().replace(/^(the|a|an) /, '').replace(/[^a-z0-9]+/g, ' ').trim();
const sameBook = (a: { title?: string; author?: string }, b: { title?: string; author?: string }) => {
  const x = tnorm(a.title), y = tnorm(b.title);
  if (!x || !y) return false;
  if (x === y) return true;
  const sa = tnorm(a.author).split(' ').pop(), sb = tnorm(b.author).split(' ').pop();
  return !!sa && sa === sb && (x.startsWith(y) || y.startsWith(x));
};

type Toast = { key: string; text: string; tone: string };

export default function SessionFinder({ onSnapshot }: { onSnapshot: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const focused = useIsFocused();
  const { height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ended, setEnded] = useState(false);
  const [items, setItems] = useState<Record<string, Found>>({});
  const [frames, setFrames] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [cost, setCost] = useState(0);
  const [lastScout, setLastScout] = useState(0);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [inView, setInView] = useState(0);
  const store = useRef<Record<string, Found>>({});
  const counter = useRef(0);
  const recRef = useRef(false);
  recRef.current = recording;

  const celebrate = useCallback((f: Found) => {
    if (f.status !== 'pick' && f.status !== 'missing') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const t: Toast = { key: f.key, text: `${f.status === 'pick' ? '★' : '◆'} ${f.title}`, tone: f.status === 'pick' ? colors.gold : colors.missing };
    setToasts((cur) => [...cur.filter((x) => x.key !== t.key), t].slice(-3));
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.key !== t.key)), 2600);
  }, []);

  const update = useCallback(
    (k: string, patch: Partial<Found>) => {
      const cur = store.current[k];
      if (!cur) return;
      let next = { ...cur, ...patch };
      // the same book read in another frame (or another block): keep one entry
      if (patch.title && DONE.includes(next.status) && next.status !== 'noise') {
        const twin = Object.values(store.current).find((o) => o.key !== k && o.status !== 'noise' && sameBook(o, next));
        if (twin) next = { ...next, status: 'noise' };
      }
      store.current[k] = next;
      setItems({ ...store.current });
      if (next.status !== cur.status) celebrate(next);
    },
    [celebrate],
  );

  /** An extra book found inside one camera text (several spines read as one block). */
  const addBook = useCallback(
    (from: Found, patch: Partial<Found>) => {
      if (Object.values(store.current).some((o) => o.status !== 'noise' && sameBook(o, patch))) return;
      const key = `s${counter.current}`;
      const f: Found = { key, text: from.text, tokens: new Set(), status: 'reading', order: counter.current++ };
      store.current[key] = f;
      update(key, patch);
    },
    [update],
  );

  /** Same spine seen again (OCR text varies frame to frame) → reuse its entry. */
  const findSame = (tokens: Set<string>): string | null => {
    for (const f of Object.values(store.current)) {
      let inter = 0;
      tokens.forEach((t) => f.tokens.has(t) && inter++);
      const union = tokens.size + f.tokens.size - inter;
      if (union && inter / union >= 0.5) return f.key;
    }
    return null;
  };

  // ---------------------------------------------------------------- pipeline
  const handleTexts = useCallback(
    async (texts: string[]) => {
      const fresh: Found[] = [];
      for (const text of texts) {
        const tk = new Set(words(text));
        if (tk.size < 1 || text.replace(/[^A-Za-z]/g, '').length < 5) continue;
        const same = findSame(tk);
        if (same) {
          // keep the richer reading of this spine
          const cur = store.current[same];
          if (text.length > cur.text.length && cur.status === 'reading') store.current[same] = { ...cur, text, tokens: tk };
          continue;
        }
        const f: Found = { key: `s${counter.current}`, text, tokens: tk, status: 'reading', order: counter.current++ };
        store.current[f.key] = f;
        fresh.push(f);
      }
      if (!fresh.length) return;
      setItems({ ...store.current });

      // phase 1 — your library (plain code, ~0.2 s)
      let unknown: Found[] = fresh;
      try {
        const m = await api.liveMatch(fresh.map((f, i) => ({ id: i, text: f.text })));
        unknown = [];
        m.books.forEach((b: any, i: number) => {
          const f = fresh[i];
          if (b.status === 'owned' || b.status === 'missing' || b.status === 'flagged') {
            update(f.key, { status: b.status, title: b.title, author: b.author, note: b.note, bookId: b.book_id });
            if (b.more) unknown.push(f); // the block runs on into neighbouring spines
          } else if (b.status === 'pick') {
            update(f.key, { status: 'pick', title: b.title, author: b.author, note: b.note, stars: 5, bookId: b.book_id });
            if (b.more) unknown.push(f);
          } else {
            update(f.key, { status: 'scouting' });
            unknown.push(f);
          }
        });
      } catch {
        unknown.forEach((f) => update(f.key, { status: 'scouting' }));
      }
      if (!unknown.length) return;

      // phase 2 — a team of Scout agents in parallel (~2.5 s)
      const t0 = Date.now();
      try {
        const r = await api.sessionScout(unknown.map((f, i) => ({ id: i, text: f.text })));
        setCost((c) => c + (r.usage?.cost_usd || 0));
        setLastScout(Date.now() - t0);
        const got = new Set<number>();
        const asPatch = (x: any): Partial<Found> =>
          x.owned_id
            ? { status: 'owned', title: x.title, author: x.author, bookId: x.owned_id, note: 'Already in your library' }
            : x.gap
              ? { status: 'missing', title: x.title, author: x.author, note: `Completes ${x.gap.collection} · vol. ${x.gap.index}` }
              : {
                  status: x.stars >= 4 || x.collectible ? 'pick' : 'book',
                  title: x.title,
                  author: x.author,
                  stars: x.stars,
                  note: x.reason,
                  collectible: !!x.collectible,
                  collectibleWhy: x.collectible_why,
                  priceSeen: x.price_seen,
                  friendsOwn: x.friends_own,
                };
        r.results.forEach((x: any) => {
          const f = unknown[x.id];
          if (!f) return;
          got.add(x.id);
          const already = DONE.includes(store.current[f.key]?.status) && store.current[f.key]?.status !== 'noise';
          if (x.flagged) return already ? undefined : update(f.key, { status: 'flagged', note: 'Text looked like instructions to an AI — ignored.' });
          const books: any[] = x.books?.length ? x.books : x.is_book && x.title ? [x] : [];
          if (!books.length) return already ? undefined : update(f.key, { status: 'noise' });
          books.forEach((bk, j) => {
            const patch = { ...asPatch(bk), priceSeen: x.price_seen };
            if (j === 0 && !already) update(f.key, patch);
            else addBook(f, patch);
          });
        });
        unknown.forEach((f, i) => !got.has(i) && store.current[f.key]?.status === 'scouting' && update(f.key, { status: 'noise' }));
      } catch (e: any) {
        unknown.forEach((f) => store.current[f.key]?.status === 'scouting' && update(f.key, { status: 'noise' }));
        setError(e?.message || 'Scouts unavailable');
      }
    },
    [update, addBook],
  );

  // capture loop — runs only while recording
  useEffect(() => {
    if (!recording || !ready || !focused) return;
    let alive = true;
    const started = Date.now() - elapsed * 1000;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    const loop = async () => {
      while (alive && recRef.current) {
        try {
          const pic = await cam.current?.takePictureAsync({ quality: 0.45, shutterSound: false });
          if (!pic?.uri || !alive) break;
          const ocr = await readShelf(pic.uri, { fast: true });
          setFrames((n) => n + 1);
          setInView(ocr.blocks.length);
          handleTexts(ocr.blocks.map((b) => b.text)); // don't wait: keep sweeping
        } catch (e: any) {
          setError(e?.message || 'Camera error');
          await new Promise((r) => setTimeout(r, 600));
        }
      }
    };
    loop();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [recording, ready, focused]);

  const all = useMemo(() => Object.values(items), [items]);
  const real = all.filter((f) => f.status !== 'noise');
  const done = real.filter((f) => DONE.includes(f.status)).length;
  const pct = real.length ? Math.round((done / real.length) * 100) : 0;
  const shown = useMemo(
    () =>
      all
        .filter((f) => f.status !== 'noise')
        .sort((a, b) => rank(a) - rank(b) || (b.stars || 0) - (a.stars || 0) || b.order - a.order),
    [all],
  );

  const toggle = () => {
    tap();
    if (recording) {
      setRecording(false);
      setEnded(true);
    } else {
      setEnded(false);
      setError('');
      setRecording(true);
    }
  };

  const reset = () => {
    tap();
    store.current = {};
    setItems({});
    setFrames(0);
    setElapsed(0);
    setCost(0);
    setEnded(false);
  };

  const save = async (f: Found, status: 'owned' | 'wishlist') => {
    tap();
    if (!f.title) return;
    try {
      const b = await api.addBook({ title: f.title, author: f.author || '', status });
      update(f.key, { saved: status, bookId: b.id });
    } catch {}
  };

  if (!permission?.granted) {
    return (
      <View style={[s.center, { backgroundColor: colors.wall }]}>
        <Italic color={colors.wallText} style={{ textAlign: 'center', marginBottom: 14 }}>
          The finder needs the camera to see the shelf.
        </Italic>
        <Button label="Allow camera" onPress={requestPermission} />
      </View>
    );
  }

  const camH = ended ? height * 0.2 : height * 0.46;

  return (
    <View style={{ flex: 1, backgroundColor: colors.wall }}>
      {/* camera */}
      <View style={{ height: camH, overflow: 'hidden' }}>
        {focused && (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} onCameraReady={() => setReady(true)} />
        )}
        <LinearGradient colors={['rgba(5,13,26,0.8)', 'rgba(5,13,26,0)', 'rgba(5,13,26,0.9)']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
        <View style={{ paddingTop: insets.top + 10, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {recording && <RecDot />}
            <Caps color={colors.wallMuted}>{recording ? `Recording · ${fmt(elapsed)}` : ended ? 'Session complete' : 'The Book Finder'}</Caps>
          </View>
          {!recording && !ended && (
            <Italic color={colors.wallText} style={{ fontSize: 18, marginTop: 6, textAlign: 'center', paddingHorizontal: 30 }}>
              Press record, then sweep slowly along the shelves.
            </Italic>
          )}
        </View>
        {recording && <Beam />}
        {recording && (
          <View style={s.inView} pointerEvents="none">
            <Caps color={colors.gold} style={{ fontSize: 8.5 }}>{`${inView} spine${inView === 1 ? '' : 's'} in view`}</Caps>
          </View>
        )}
        <View style={s.toasts} pointerEvents="none">
          {toasts.map((t) => (
            <Animated.View key={t.key} entering={FadeInDown.duration(300)} exiting={FadeOut.duration(400)} style={[s.toast, { borderColor: t.tone }]}>
              <Text numberOfLines={1} style={[s.toastText, { color: t.tone }]}>{t.text}</Text>
            </Animated.View>
          ))}
        </View>
        {/* progress ring + record button */}
        {!recording && !ended && (
          <Tip id="finder-record" text="Press record and sweep slowly along the spines. Finds appear below, best first." style={{ bottom: 100, left: 40, right: 40 }} />
        )}
        <View style={s.controls}>
          <Ring pct={pct} />
          <Pressable onPress={toggle} disabled={!ready} accessibilityRole="button" accessibilityLabel={recording ? 'Stop recording' : 'Start recording'} style={[s.rec, !ready && { opacity: 0.4 }]}>
            <View style={recording ? s.recStop : s.recDot} />
          </Pressable>
          <View style={{ width: 64, alignItems: 'center' }}>
            <Text style={s.bigNum}>{real.length}</Text>
            <Caps color={colors.wallMuted} style={{ fontSize: 8 }}>spines</Caps>
          </View>
        </View>
      </View>

      {/* live stats */}
      <View style={s.statsBar}>
        <Caps color={colors.wallMuted} style={{ fontSize: 8.5 }}>
          {`${frames} frames read · ${pct}% identified · scouts ${(lastScout / 1000).toFixed(1)} s · ${money(cost)}`}
        </Caps>
      </View>
      {!!error && <ErrorNote dark message={error} />}

      {/* books, as they're found */}
      <FlatList
        data={shown}
        keyExtractor={(f) => f.key}
        contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 30 }}
        ListHeaderComponent={
          ended && shown.length ? (
            <Animated.View entering={FadeIn} style={{ marginBottom: 6 }}>
              <Text style={s.summaryTitle}>{summary(shown)}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Chip dark label="New session" onPress={reset} />
                <Chip dark label="Photo scan" onPress={onSnapshot} />
              </View>
            </Animated.View>
          ) : undefined
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 20, gap: 10 }}>
            <Italic color={colors.wallMuted} style={{ textAlign: 'center' }}>
              {recording ? 'Listening for spines…' : 'Books will appear here as they are found.'}
            </Italic>
            {!recording && <Chip dark label="Or take a single photo" onPress={onSnapshot} />}
          </View>
        }
        renderItem={({ item: f }) => (
          <Animated.View entering={FadeInDown.duration(350)} layout={LinearTransition.duration(250)}>
          <Pressable
            disabled={!f.title || !['pick', 'book', 'missing'].includes(f.status)}
            onPress={() => {
              tap();
              router.push({
                pathname: '/pick',
                params: {
                  title: f.title || '',
                  author: f.author || '',
                  stars: String(f.stars || 3),
                  reason: f.note || '',
                  collectible: f.collectible ? '1' : '',
                  why: f.collectibleWhy || '',
                  price: f.priceSeen || '',
                },
              });
            }}
            accessibilityHint="Shows why this book was recommended"
            style={[s.row, f.status === 'pick' && s.rowPick]}
          >
            <View style={[s.badge, { borderColor: tone(f.status) }, f.status === 'pick' && { backgroundColor: colors.gold }]}>
              <Text style={{ color: f.status === 'pick' ? colors.paper : tone(f.status), fontFamily: fonts.displayBold, fontSize: 12 }}>{glyph(f.status)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Caps style={{ fontSize: 8.5, color: tone(f.status) }}>{label(f.status)}</Caps>
              <Text numberOfLines={1} style={s.title}>
                {f.title || f.text}
              </Text>
              {!!f.author && <Text numberOfLines={1} style={s.author}>{f.author}</Text>}
              {(f.status === 'pick' || f.status === 'book') && !!f.stars && <Stars n={f.stars} size={11} />}
              {f.collectible && (
                <Caps color={colors.gold} style={{ fontSize: 8.5, marginTop: 3 }}>{`◆ Possibly valuable${f.priceSeen ? ` · sticker ${f.priceSeen}` : ''}`}</Caps>
              )}
              {!!f.friendsOwn?.length && <Caps color={colors.owned} style={{ fontSize: 8.5, marginTop: 3 }}>{`${f.friendsOwn.join(' & ')} owns this`}</Caps>}
              {!!f.note && f.status !== 'scouting' && (
                <Text numberOfLines={2} style={s.note}>
                  {f.note}
                </Text>
              )}
            </View>
            {(f.status === 'pick' || f.status === 'book' || f.status === 'missing') && f.title ? (
              f.saved ? (
                <Caps color={colors.owned} style={{ fontSize: 8.5 }}>{f.saved === 'owned' ? '✓ added' : '♡ wanted'}</Caps>
              ) : (
                <View style={{ gap: 6 }}>
                  <Pressable onPress={() => save(f, 'wishlist')} style={s.mini} accessibilityLabel="Add to wishlist">
                    <Caps color={colors.wallText} style={{ fontSize: 8.5 }}>Want</Caps>
                  </Pressable>
                  <Pressable onPress={() => save(f, 'owned')} style={[s.mini, { backgroundColor: colors.gold, borderColor: colors.gold }]} accessibilityLabel="I own it">
                    <Caps color={colors.paper} style={{ fontSize: 8.5 }}>Own</Caps>
                  </Pressable>
                </View>
              )
            ) : f.status === 'owned' && f.bookId ? (
              <Pressable onPress={() => router.push(`/book/${f.bookId}`)} style={s.mini}>
                <Caps color={colors.wallText} style={{ fontSize: 8.5 }}>View</Caps>
              </Pressable>
            ) : null}
          </Pressable>
          </Animated.View>
        )}
      />
    </View>
  );
}

// ------------------------------------------------------------------ helpers

function rank(f: Found) {
  return ({ pick: 0, missing: 1, book: 2, scouting: 3, reading: 4, owned: 5, flagged: 6 } as Record<string, number>)[f.status] ?? 9;
}
function tone(s: Status) {
  return ({ pick: colors.gold, missing: colors.missing, owned: colors.owned, flagged: colors.flagged, book: colors.wallText } as Record<string, string>)[s] || colors.wallMuted;
}
function glyph(s: Status) {
  return ({ pick: '★', missing: '◆', owned: '✓', flagged: '!', book: '·', scouting: '…', reading: '…' } as Record<string, string>)[s] || '·';
}
function label(s: Status) {
  return (
    {
      pick: 'Pick for you',
      missing: 'Completes a collection',
      owned: 'In your library',
      flagged: 'Ignored · suspicious text',
      book: 'On the shelf',
      scouting: 'Scouts identifying…',
      reading: 'Checking your library…',
    } as Record<string, string>
  )[s];
}
function summary(list: Found[]) {
  const c = (k: Status) => list.filter((f) => f.status === k).length;
  const parts = [];
  if (c('pick')) parts.push(`${c('pick')} for you`);
  if (c('missing')) parts.push(`${c('missing')} to complete a set`);
  if (c('owned')) parts.push(`${c('owned')} already yours`);
  return parts.join(' · ') || `${list.length} books seen`;
}
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Ring({ pct }: { pct: number }) {
  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={64} height={64} style={StyleSheet.absoluteFill}>
        <Circle cx={32} cy={32} r={R} stroke="rgba(169,205,190,0.25)" strokeWidth={3} fill="none" />
        <Circle
          cx={32}
          cy={32}
          r={R}
          stroke={colors.gold}
          strokeWidth={3}
          fill="none"
          strokeDasharray={`${(C * pct) / 100} ${C}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
      </Svg>
      <Text style={{ fontFamily: fonts.display, fontSize: 17, color: colors.wallText }}>{pct}%</Text>
    </View>
  );
}

/** A sliver of light sweeping across the shelf while recording. */
function Beam() {
  const { width } = useWindowDimensions();
  const x = useSharedValue(0);
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 2200 }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * (width - 60) }] }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: 60 }, st]}>
      <LinearGradient
        colors={['rgba(242,181,58,0)', 'rgba(242,181,58,0.16)', 'rgba(247,200,99,0.42)', 'rgba(242,181,58,0.16)', 'rgba(242,181,58,0)']}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={{ flex: 1 }}
      />
    </Animated.View>
  );
}

function RecDot() {
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.25, { duration: 700 }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.flagged }, st]} />;
}

const s = StyleSheet.create({
  inView: { position: 'absolute', top: 70, right: 14, backgroundColor: 'rgba(5,13,26,0.6)', paddingHorizontal: 8, paddingVertical: 4 },
  toasts: { position: 'absolute', left: 14, right: 14, bottom: 100, gap: 6, alignItems: 'flex-start' },
  toast: { backgroundColor: 'rgba(5,13,26,0.82)', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, maxWidth: '90%' },
  toastText: { fontFamily: fonts.display, fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  controls: { position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly' },
  rec: { width: 74, height: 74, borderRadius: 37, borderWidth: 2, borderColor: colors.cream, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.flagged },
  recStop: { width: 28, height: 28, borderRadius: 4, backgroundColor: colors.flagged },
  bigNum: { fontFamily: fonts.display, fontSize: 26, color: colors.wallText, lineHeight: 30 },
  statsBar: { paddingVertical: 8, alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: 'rgba(13,28,51,0.9)', padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  rowPick: { borderColor: colors.gold, borderWidth: 1, backgroundColor: 'rgba(242,181,58,0.08)' },
  badge: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.2, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 18, color: colors.wallText, lineHeight: 21 },
  author: { fontFamily: fonts.bodyItalic, fontSize: 13, color: colors.wallMuted },
  note: { fontFamily: fonts.bodyItalic, fontSize: 12.5, color: colors.inkSoft, marginTop: 3, lineHeight: 16 },
  mini: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(242,181,58,0.6)', alignItems: 'center' },
  summaryTitle: { fontFamily: fonts.displayItalic, fontSize: 20, color: colors.wallText },
});
