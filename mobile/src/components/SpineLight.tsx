// A sliver of lamplight down a spine, with dust motes drifting up through it —
// the Book Finder's way of saying "look here". No boxes.
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, fonts } from '@/theme';

type Kind = 'pick' | 'missing' | 'owned' | 'flagged';

const TONE: Record<Kind, { core: string; glow: string; dust: string; motes: number; strength: number }> = {
  pick: { core: '#FFD98A', glow: 'rgba(242,181,58,', dust: '#F7C863', motes: 7, strength: 1 },
  missing: { core: '#D7E8FF', glow: 'rgba(159,195,240,', dust: '#CFE2FA', motes: 4, strength: 0.75 },
  owned: { core: '#CFE6DB', glow: 'rgba(169,205,190,', dust: '#A9CDBE', motes: 0, strength: 0.45 },
  flagged: { core: '#F1A48F', glow: 'rgba(231,120,92,', dust: '#E7785C', motes: 0, strength: 0.5 },
};

function Mote({ h, delay, x, color }: { h: number; delay: number; x: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2600 + (delay % 900), easing: Easing.out(Easing.quad) }), -1));
  }, []);
  const st = useAnimatedStyle(() => ({
    opacity: Math.sin(t.value * Math.PI) * 0.95,
    transform: [{ translateY: -t.value * h * 0.8 }, { translateX: Math.sin(t.value * 6.28) * 5 }],
  }));
  return <Animated.View style={[{ position: 'absolute', bottom: h * 0.1, left: x, width: 3, height: 3, borderRadius: 2, backgroundColor: color }, st]} />;
}

export default function SpineLight({
  kind,
  cx,
  cy,
  height,
  angle = 0,
  label,
  selected,
  delay = 0,
  onPress,
  accessibilityLabel,
}: {
  kind: Kind;
  cx: number;
  cy: number;
  height: number;
  angle?: number;
  label?: string;
  selected?: boolean;
  delay?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const tone = TONE[kind];
  const h = Math.max(48, height);
  const breathe = useSharedValue(0.55);
  useEffect(() => {
    breathe.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(0.55, { duration: 1600, easing: Easing.inOut(Easing.sin) })), -1),
    );
  }, []);
  const glowSt = useAnimatedStyle(() => ({ opacity: breathe.value * tone.strength * (selected ? 1.3 : 1) }));
  const W = 34; // hit area / glow width
  const motes = useMemo(() => Array.from({ length: tone.motes }, (_, i) => ({ delay: delay + i * 380, x: W / 2 - 6 + ((i * 7) % 12) })), [tone.motes, delay]);

  return (
    <Animated.View
      entering={ZoomIn.delay(delay).duration(500)}
      style={{ position: 'absolute', left: cx - W / 2, top: cy - h / 2, width: W, height: h, transform: [{ rotate: `${angle}deg` }] }}
    >
      <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={StyleSheet.absoluteFill}>
        {/* wide soft glow */}
        <Animated.View style={[StyleSheet.absoluteFill, glowSt]}>
          <LinearGradient
            colors={[`${tone.glow}0)`, `${tone.glow}0.42)`, `${tone.glow}0.42)`, `${tone.glow}0)`]}
            locations={[0, 0.25, 0.75, 1]}
            style={{ position: 'absolute', left: 4, right: 4, top: 0, bottom: 0, borderRadius: 14 }}
          />
          {/* the bright sliver */}
          <LinearGradient
            colors={[`${tone.glow}0)`, tone.core, tone.core, `${tone.glow}0)`]}
            locations={[0, 0.2, 0.8, 1]}
            style={{ position: 'absolute', left: W / 2 - (selected ? 3 : 2), width: selected ? 6 : 4, top: 0, bottom: 0, borderRadius: 3 }}
          />
        </Animated.View>
        {motes.map((m, i) => (
          <Mote key={i} h={h} delay={m.delay} x={m.x} color={tone.dust} />
        ))}
        {!!label && (
          <View style={[s.tag, { borderColor: tone.core }, kind === 'pick' && { backgroundColor: colors.gold }]}>
            <Text style={{ fontFamily: fonts.displayBold, fontSize: 11, color: kind === 'pick' ? colors.paper : tone.core }}>{label}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  tag: {
    position: 'absolute',
    bottom: -9,
    alignSelf: 'center',
    minWidth: 18,
    height: 18,
    paddingHorizontal: 3,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,13,26,0.85)',
  },
});
