import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import WindowLight from '@/components/WindowLight';
import { refreshWidget } from '@/widget/refresh';
import BookCover from '@/components/BookCover';
import { Caps, Italic, Ornament, Rule, tap } from '@/components/ui';
import { api, Book, Stats } from '@/api';
import { APP_NAME, colors, fonts } from '@/theme';

type Quote = { index: number; text: string; author: string; work: string };

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reading, setReading] = useState<Book[]>([]);
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const [q, st, books, me] = await Promise.all([api.quote(), api.stats(), api.books('owned'), api.me().catch(() => null)]);
      setQuote(q);
      setStats(st);
      setReading(books.filter((b) => b.reading));
      setName(me?.signed_in ? me.display_name.split(' ')[0] : '');
      const r = books.find((b) => b.reading);
      refreshWidget({
        name: 'The Book Butler',
        reading: r ? { title: r.title, author: r.author, progress: r.progress || 0 } : null,
        books: st.books,
        hours: Math.round(st.hours_read),
        toFind: st.missing_from_collections,
      });
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const nextQuote = async () => {
    tap();
    try {
      setQuote(await api.quote(quote?.index));
    } catch {}
  };

  const first = quote?.text?.[0] ?? '';
  const rest = quote?.text?.slice(1) ?? '';

  return (
    <View style={{ flex: 1 }}>
      <WindowLight />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 28, paddingBottom: 40, paddingHorizontal: 28 }}>
        <Caps style={{ textAlign: 'center' }}>{name ? `${greeting()}, ${name}` : APP_NAME}</Caps>
        <Rule style={{ width: 28, alignSelf: 'center', marginTop: 10, backgroundColor: colors.sepia }} />

        {/* The quote: italic serif with a script initial, like an illuminated page */}
        <Pressable onPress={nextQuote} accessibilityHint="Shows another quote" style={{ minHeight: 280, justifyContent: 'center' }}>
          {quote ? (
            <Animated.View key={quote.index} entering={FadeIn.duration(900)} exiting={FadeOut.duration(300)}>
              <QuoteText first={first} rest={rest} />
              <Ornament />
              <Caps style={{ textAlign: 'center', color: colors.inkSoft }}>{quote.author}</Caps>
              {!!quote.work && <Italic style={{ textAlign: 'center', fontSize: 15, marginTop: 2 }}>{quote.work}</Italic>}
            </Animated.View>
          ) : offline ? (
            <Italic style={{ textAlign: 'center' }}>
              The library server is resting.{'\n'}Set its address in Settings.
            </Italic>
          ) : null}
        </Pressable>

        {/* Stats, set like an invitation: 31 | VOLUMES */}
        {stats && (
          <Animated.View entering={FadeIn.delay(300).duration(800)} style={s.statsRow}>
            {[
              [stats.books, 'volumes'],
              [Math.round(stats.hours_read), 'hours read'],
              [stats.authors, 'authors'],
              [stats.missing_from_collections, 'to find'],
            ].map(([n, label], i) => (
              <React.Fragment key={String(label)}>
                {i > 0 && <View style={s.vrule} />}
                <View style={s.stat}>
                  <CountUp value={Number(n)} style={s.statNum} />
                  <Caps style={{ fontSize: 9, letterSpacing: 1.8 }}>{String(label)}</Caps>
                </View>
              </React.Fragment>
            ))}
          </Animated.View>
        )}

        {reading.length > 0 && (
          <Animated.View entering={FadeIn.delay(600).duration(800)} style={{ marginTop: 34 }}>
            <Caps style={{ textAlign: 'center', marginBottom: 14 }}>Currently reading</Caps>
            {reading.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => {
                  tap();
                  router.push(`/book/${b.id}`);
                }}
                style={s.readingCard}
              >
                <BookCover title={b.title} author={b.author} uri={b.cover_url} width={44} />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={s.readingTitle} numberOfLines={1}>
                    {b.title}
                  </Text>
                  <Italic style={{ fontSize: 14 }}>{b.author}</Italic>
                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${Math.round((b.progress || 0) * 100)}%` }]} />
                  </View>
                  <Caps style={{ fontSize: 9, marginTop: 4 }}>{`${Math.round((b.progress || 0) * 100)}% · ${b.hours_read} h`}</Caps>
                </View>
              </Pressable>
            ))}
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

/** The quote writes itself in, word by word, with a script initial. */
function QuoteText({ first, rest }: { first: string; rest: string }) {
  const words = rest.split(' ');
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end' }}>
      <Animated.Text entering={FadeIn.duration(1400)} style={s.initial}>
        {first}
      </Animated.Text>
      {words.map((w, i) => (
        <Animated.Text key={i} entering={FadeInDown.delay(250 + i * 85).duration(650)} style={s.quote}>
          {(i === 0 ? '' : ' ') + w}
        </Animated.Text>
      ))}
    </View>
  );
}

/** Numbers that count up when the screen opens. */
function CountUp({ value, style }: { value: number; style: any }) {
  const [n, setN] = useState(0);
  React.useEffect(() => {
    let raf = 0;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / 1400);
      setN(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <Text style={style}>{n}</Text>;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const s = StyleSheet.create({
  quote: {
    fontFamily: fonts.displayItalic,
    fontSize: 29,
    lineHeight: 39,
    color: colors.ink,
  },
  initial: { fontFamily: fonts.script, fontSize: 58, color: colors.gold, lineHeight: 62, marginRight: 2 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  stat: { alignItems: 'center', paddingHorizontal: 12 },
  statNum: { fontFamily: fonts.displayLight, fontSize: 34, color: colors.ink, lineHeight: 40 },
  vrule: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.sepia, opacity: 0.6 },
  readingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(13,28,51,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    marginBottom: 10,
  },
  readingTitle: { fontFamily: fonts.display, fontSize: 19, color: colors.ink },
  progressTrack: { height: 1, backgroundColor: colors.line, marginTop: 8 },
  progressFill: { height: 1, backgroundColor: colors.gold },
});
