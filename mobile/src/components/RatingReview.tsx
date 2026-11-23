// Your verdict on a book: Finished / Did not finish, a quarter-star rating
// (tap a star, or slide a finger along them for ¼ steps), and a private review.
import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Caps, Italic, tap } from '@/components/ui';
import { colors, fonts } from '@/theme';

type Props = {
  rating?: number | null;
  review?: string | null;
  readState?: string | null;
  onChange: (changes: { rating?: number | null; review?: string | null; read_state?: string; reading?: boolean; finished_on?: string | null; progress?: number }) => void;
};

const STAR = 30;
const GAP = 6;

export function QuarterStars({ value, size = STAR, onSet }: { value: number; size?: number; onSet?: (v: number) => void }) {
  const width = 5 * size + 4 * GAP;
  const from = (x: number) => {
    // map the finger position to 0.25 steps, gaps included
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const left = i * (size + GAP);
      if (x >= left + size) v = i + 1;
      else if (x > left) v = i + Math.ceil(((x - left) / size) * 4) / 4;
    }
    return Math.max(0.25, Math.min(5, v));
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !!onSet,
        onMoveShouldSetPanResponder: (_, g) => !!onSet && Math.abs(g.dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => onSet?.(from(e.nativeEvent.locationX)),
        onPanResponderMove: (e) => onSet?.(from(e.nativeEvent.locationX)),
      }),
    [onSet, size],
  );
  return (
    <View style={{ width, height: size, flexDirection: 'row', gap: GAP }} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={`${value} of 5 stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i));
        return (
          <View key={i} style={{ width: size, height: size }} pointerEvents="none">
            <Text style={[st.star, { fontSize: size, lineHeight: size + 4, color: 'rgba(242,181,58,0.22)' }]}>★</Text>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: size * fill, overflow: 'hidden' }}>
              <Text style={[st.star, { fontSize: size, lineHeight: size + 4, color: colors.gold, width: size }]}>★</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function RatingReview({ rating, review, readState, onChange }: Props) {
  const [stars, setStars] = useState<number>(rating || 0);
  const [text, setText] = useState(review || '');
  const [saved, setSaved] = useState(false);
  const commit = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setRating = (v: number) => {
    setStars(v);
    if (commit.current) clearTimeout(commit.current);
    commit.current = setTimeout(() => {
      tap();
      onChange({ rating: v });
    }, 350);
  };
  const today = new Date().toISOString().slice(0, 10);
  const state = (s: '' | 'read' | 'dnf') => {
    tap();
    if (s === 'read') onChange({ read_state: 'read', reading: false, progress: 1, finished_on: today });
    else if (s === 'dnf') onChange({ read_state: 'dnf', reading: false, finished_on: today });
    else onChange({ read_state: '', finished_on: null });
  };

  return (
    <View style={st.box}>
      <Caps style={{ color: colors.sepia }}>Your verdict</Caps>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {(
          [
            ['read', 'Finished'],
            ['dnf', 'Did not finish'],
          ] as const
        ).map(([k, label]) => (
          <Pressable key={k} onPress={() => state(readState === k ? '' : k)} style={[st.chip, readState === k && (k === 'dnf' ? st.chipDnf : st.chipOn)]} accessibilityState={{ selected: readState === k }}>
            <Caps style={{ fontSize: 9, color: readState === k ? colors.paper : colors.inkSoft }}>{label}</Caps>
          </Pressable>
        ))}
      </View>
      {readState === 'dnf' && (
        <Animated.View entering={FadeIn}>
          <Italic style={{ fontSize: 13.5, marginTop: 8 }}>Life is short. The Butler won't recommend books like this one as eagerly.</Italic>
        </Animated.View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 16 }}>
        <QuarterStars value={stars} onSet={setRating} />
        <Text style={st.num}>{stars ? stars.toFixed(2).replace(/\.?0+$/, '') : '–'}</Text>
      </View>
      <Italic style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>Slide along the stars for quarter stars.</Italic>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          setSaved(false);
        }}
        onBlur={() => {
          if ((review || '') !== text) {
            onChange({ review: text.trim() || null });
            setSaved(true);
          }
        }}
        multiline
        placeholder="A few lines for yourself — what stayed with you?"
        placeholderTextColor={colors.sepiaSoft}
        style={st.review}
        maxLength={4000}
        accessibilityLabel="Your review"
      />
      {saved && <Caps style={{ fontSize: 8, color: colors.owned, marginTop: 4 }}>saved</Caps>}
    </View>
  );
}

const st = StyleSheet.create({
  box: { marginTop: 18, paddingTop: 16, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  chip: { borderWidth: 1, borderColor: colors.line, paddingVertical: 8, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.owned, borderColor: colors.owned },
  chipDnf: { backgroundColor: '#B5634B', borderColor: '#B5634B' },
  star: { textAlign: 'center', includeFontPadding: false },
  num: { fontFamily: fonts.displayLight, fontSize: 28, color: colors.gold },
  review: { marginTop: 14, minHeight: 90, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, padding: 10, fontFamily: fonts.bodyItalic, fontSize: 16, color: colors.ink, textAlignVertical: 'top' },
});
