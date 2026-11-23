// The welcome tour: six cards, swipe or tap Next. Shown once on first launch;
// "Replay the tour" in Settings brings it (and every tooltip) back.
import React, { useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import Logo from '@/components/Logo';
import { finishTour } from '@/components/Tip';
import { Button, Caps, tap } from '@/components/ui';
import { colors, fonts } from '@/theme';

const SLIDES = [
  {
    glyph: null,
    kicker: 'Welcome',
    title: 'The Book Butler',
    body: 'Your library, kept like a museum — and a butler who knows it by heart. Thirty seconds, six cards.',
  },
  {
    glyph: '◉',
    kicker: '1 · The Book Finder',
    title: 'Sweep a shelf, find your next book',
    body: 'In a bookshop, press record and move slowly along the spines. A team of Scout agents reads them all at once:\n★ picks for you · ◆ completes a set · ✓ already yours · ◆ possibly valuable.',
  },
  {
    glyph: '▥',
    kicker: '2 · Your bookcase',
    title: 'Every book in 3D',
    body: 'Tap a spine to take it off the shelf, then open the showcase to turn it in your hand. Collections shows series side by side and every edition you own.',
  },
  {
    glyph: '◫',
    kicker: '3 · Adding books',
    title: 'Front, back, spine — done',
    body: 'Photograph a book and the Butler reads it, cuts your hand out of the picture and builds its model. Bring Goodreads or Libib across in one go. Duplicates are flagged before you buy twice.',
  },
  {
    glyph: '♜',
    kicker: '4 · Characters',
    title: 'Bring them to life',
    body: "Meet a book's characters as antique marble busts, standing in your room. Keep a favourite on top of your bookcase.",
  },
  {
    glyph: '❦',
    kicker: '5 · The Librarian & friends',
    title: 'Ask anything. Share everything.',
    body: "Ask the Librarian — or just speak. Rate with quarter stars, mark DNF, and see what friends thought of the books on your wishlist. Free audiobooks and ebooks are linked where they exist.",
  },
];

export default function Tour() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [i, setI] = useState(0);
  const ref = useRef<any>(null);

  const leave = () => {
    finishTour();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };
  const go = (k: number) => {
    tap();
    if (k >= SLIDES.length) return leave();
    ref.current?.scrollTo({ x: k * width, animated: true });
    setI(k);
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setI(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 8 }}>
        <Pressable onPress={leave} hitSlop={12} accessibilityRole="button">
          <Caps style={{ color: colors.inkSoft }}>Skip</Caps>
        </Pressable>
      </View>
      <ScrollView ref={ref} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        {SLIDES.map((sl, k) => (
          <View key={k} style={{ width, height: '100%', paddingHorizontal: 30, justifyContent: 'center', paddingBottom: 40 }}>
            {k === i && (
              <Animated.View entering={FadeIn.duration(500)} style={{ alignItems: 'center' }}>
                {sl.glyph ? (
                  <View style={s.medal}>
                    <Text style={s.glyph}>{sl.glyph}</Text>
                  </View>
                ) : (
                  <Logo size={110} />
                )}
                <Animated.View entering={FadeInDown.delay(120).duration(500)}>
                  <Caps style={{ color: colors.gold, textAlign: 'center', marginTop: 26 }}>{sl.kicker}</Caps>
                </Animated.View>
                <Animated.View entering={FadeInDown.delay(220).duration(500)}>
                  <Text style={s.title}>{sl.title}</Text>
                </Animated.View>
                <Animated.View entering={FadeInDown.delay(320).duration(500)}>
                  <Text style={s.body}>{sl.body}</Text>
                </Animated.View>
              </Animated.View>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={s.dots}>
        {SLIDES.map((_, k) => (
          <View key={k} style={[s.dot, k === i && s.dotOn]} />
        ))}
      </View>
      <View style={{ paddingHorizontal: 30 }}>
        <Button label={i === SLIDES.length - 1 ? 'Begin' : 'Next'} onPress={() => go(i + 1)} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  medal: { width: 110, height: 110, borderRadius: 55, borderWidth: 1, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(242,181,58,0.07)' },
  glyph: { fontSize: 46, color: colors.gold },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink, textAlign: 'center', marginTop: 8, lineHeight: 34 },
  body: { fontFamily: fonts.bodyItalic, fontSize: 17, color: colors.inkSoft, textAlign: 'center', marginTop: 14, lineHeight: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 18 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotOn: { backgroundColor: colors.gold, width: 18 },
});
