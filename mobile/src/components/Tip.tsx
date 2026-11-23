// One-time coach marks. <Tip id="finder-record" text="…" /> shows a small gilt
// bubble the first time a screen is seen; a tap dismisses it for good.
// "Replay the tour" in Settings brings every tip back.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { colors, fonts } from '@/theme';

const KEY = 'tipsSeen';
let seen: Set<string> | null = null;
const listeners = new Set<() => void>();

async function load() {
  if (seen) return seen;
  try {
    seen = new Set(JSON.parse((await AsyncStorage.getItem(KEY)) || '[]'));
  } catch {
    seen = new Set();
  }
  return seen;
}

export async function markTip(id: string) {
  const s = await load();
  s.add(id);
  AsyncStorage.setItem(KEY, JSON.stringify([...s])).catch(() => {});
  listeners.forEach((l) => l());
}

export async function resetTips() {
  seen = new Set();
  await AsyncStorage.multiRemove([KEY, 'tourDone']).catch(() => {});
  listeners.forEach((l) => l());
}

export async function tourDone() {
  return (await AsyncStorage.getItem('tourDone').catch(() => null)) === '1';
}
export function finishTour() {
  AsyncStorage.setItem('tourDone', '1').catch(() => {});
}

type Props = {
  id: string;
  text: string;
  /** where the bubble sits, relative to its parent (position: absolute) */
  style?: ViewStyle;
  arrow?: 'up' | 'down' | 'none';
  delay?: number;
};

export default function Tip({ id, text, style, arrow = 'down', delay = 700 }: Props) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => load().then((s) => alive && setShow(!s.has(id)));
    const t = setTimeout(check, delay);
    listeners.add(check);
    return () => {
      alive = false;
      clearTimeout(t);
      listeners.delete(check);
    };
  }, [id]);
  const bob = useSharedValue(0);
  useEffect(() => {
    bob.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: (arrow === 'up' ? 1 : -1) * bob.value * 3 }] }));
  if (!show) return null;
  return (
    <Animated.View entering={FadeIn.duration(400)} exiting={FadeOut.duration(250)} style={[s.wrap, style]} pointerEvents="box-none">
      <Animated.View style={st}>
        {arrow === 'up' && <View style={[s.arrow, s.arrowUp]} />}
        <Pressable onPress={() => markTip(id)} style={s.bubble} accessibilityRole="button" accessibilityLabel={`Tip: ${text}. Tap to dismiss.`}>
          <Text style={s.text}>{text}</Text>
          <Text style={s.ok}>GOT IT</Text>
        </Pressable>
        {arrow === 'down' && <View style={[s.arrow, s.arrowDown]} />}
      </Animated.View>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', zIndex: 50, maxWidth: 260 },
  bubble: { backgroundColor: colors.cream, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.gold, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  text: { fontFamily: fonts.bodyItalic, fontSize: 14.5, color: colors.creamInk, lineHeight: 19 },
  ok: { fontFamily: fonts.body, fontSize: 9, letterSpacing: 2, color: '#8A5A00', marginTop: 6, textAlign: 'right' },
  arrow: { width: 0, height: 0, borderLeftWidth: 8, borderRightWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginLeft: 22 },
  arrowDown: { borderTopWidth: 9, borderTopColor: colors.cream },
  arrowUp: { borderBottomWidth: 9, borderBottomColor: colors.cream },
});
