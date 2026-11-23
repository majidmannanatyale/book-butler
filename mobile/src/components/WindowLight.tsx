// Home backdrop — a library at night. Warm marigold lamplight falls through an
// arched window onto a navy wall and drifts slowly; gold dust motes float in the
// beam; a branch's shadow stirs; now and then a bird crosses. Calm, like lo-fi.
import React, { useEffect, useMemo } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient as Fade } from 'expo-linear-gradient';

import { colors } from '@/theme';

function Window({ w, h }: { w: number; h: number }) {
  if (w < 50 || h < 50) return null;
  const pane = (x: number, pw: number) => {
    const r = pw / 2;
    const top = h * 0.12;
    const rows = 5;
    const rowH = (h - top - r) / rows;
    const paths = [];
    paths.push(`M${x},${top + r} A${r},${r} 0 0 1 ${x + pw},${top + r} L${x + pw},${top + r + rowH * 0.8} L${x},${top + r + rowH * 0.8} Z`);
    for (let i = 1; i < rows; i++) {
      const y = top + r + rowH * i - rowH * 0.2 + 6;
      paths.push(`M${x},${y} h${pw / 2 - 3} v${rowH - 8} h-${pw / 2 - 3} Z`);
      paths.push(`M${x + pw / 2 + 3},${y} h${pw / 2 - 3} v${rowH - 8} h-${pw / 2 - 3} Z`);
    }
    return paths;
  };
  const pw = w * 0.3;
  const all = [...pane(w * 0.12, pw), ...pane(w * 0.12 + pw + w * 0.08, pw)];
  return (
    <Svg width={w} height={h}>
      <Defs>
        <LinearGradient id="beam" x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor="#F2B53A" stopOpacity="0.22" />
          <Stop offset="0.55" stopColor="#F2B53A" stopOpacity="0.07" />
          <Stop offset="1" stopColor="#F2B53A" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <G>
        {all.map((d, i) => (
          <Path key={i} d={d} fill="url(#beam)" />
        ))}
      </G>
    </Svg>
  );
}

function Branch({ size }: { size: number }) {
  const leaves = [
    [70, 40, -30], [95, 70, 20], [60, 95, -40], [110, 110, 25], [75, 140, -25], [120, 160, 35],
    [85, 190, -20], [130, 215, 30], [95, 245, -35], [140, 270, 20],
  ];
  return (
    <Svg width={size} height={size * 1.6} viewBox="0 0 200 320">
      <G fill="rgba(2,6,14,0.45)" stroke="rgba(2,6,14,0.45)">
        <Path d="M10,0 C60,60 90,150 160,320" strokeWidth={3} fill="none" />
        {leaves.map(([x, y, r], i) => (
          <Path key={i} d="M0,0 C10,-14 34,-14 44,0 C34,14 10,14 0,0 Z" transform={`translate(${x},${y}) rotate(${r})`} stroke="none" />
        ))}
      </G>
    </Svg>
  );
}

const Bird = () => (
  <Svg width={46} height={22} viewBox="0 0 46 22">
    <Path d="M0,12 C8,4 16,4 23,12 C30,4 38,4 46,10 C38,8 30,10 23,16 C16,10 8,9 0,12 Z" fill="rgba(2,6,14,0.55)" />
  </Svg>
);

/** One floating mote of dust, caught in the lamplight. */
function Mote({ x, y, size, delay, dur, reduce }: { x: number; y: number; size: number; delay: number; dur: number; reduce: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration: dur, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [reduce]);
  const st = useAnimatedStyle(() => ({
    opacity: 0.15 + 0.65 * Math.sin(t.value * Math.PI),
    transform: [{ translateX: Math.sin(t.value * Math.PI * 2) * 14 }, { translateY: -t.value * 46 }],
  }));
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size, backgroundColor: '#F7C863' },
        st,
      ]}
    />
  );
}

export default function WindowLight() {
  const { width, height } = useWindowDimensions();
  const drift = useSharedValue(0);
  const breathe = useSharedValue(1);
  const sway = useSharedValue(0);
  const bird = useSharedValue(0);
  const [reduce, setReduce] = React.useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {});
  }, []);

  useEffect(() => {
    if (reduce) return;
    const ease = Easing.inOut(Easing.sin);
    drift.value = withRepeat(withTiming(1, { duration: 26000, easing: ease }), -1, true);
    breathe.value = withRepeat(
      withSequence(withTiming(0.7, { duration: 3800, easing: ease }), withTiming(1, { duration: 5200, easing: ease })),
      -1,
    );
    sway.value = withRepeat(withTiming(1, { duration: 5200, easing: ease }), -1, true);
    bird.value = withDelay(
      5000,
      withRepeat(withSequence(withTiming(1, { duration: 5200, easing: Easing.linear }), withTiming(1, { duration: 32000 }), withTiming(0, { duration: 0 })), -1),
    );
  }, [reduce]);

  // dust motes, scattered inside the beam
  const motes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        x: width * (0.25 + ((i * 37) % 60) / 100),
        y: height * (0.2 + ((i * 53) % 55) / 100),
        size: 1.5 + (i % 3),
        delay: (i * 700) % 5000,
        dur: 5000 + ((i * 911) % 5000),
      })),
    [width, height],
  );

  const lightStyle = useAnimatedStyle(() => ({
    opacity: breathe.value,
    transform: [{ translateX: -24 + drift.value * 48 }, { translateY: drift.value * 10 }, { skewX: '-14deg' }],
  }));
  const branchStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${-2.2 + sway.value * 4.4}deg` }] }));
  const birdStyle = useAnimatedStyle(() => {
    const t = bird.value;
    return {
      opacity: t > 0 && t < 1 ? 1 : 0,
      transform: [
        { translateX: -60 + t * (width + 120) },
        { translateY: height * 0.18 - Math.sin(t * Math.PI) * 60 },
        { scaleY: 0.7 + 0.3 * Math.abs(Math.sin(t * 40)) },
      ],
    };
  });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.paper }]} />
      {/* a warm glow where the lamp is */}
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" cx="62%" cy="30%" r="70%">
            <Stop offset="0" stopColor="#F2B53A" stopOpacity="0.10" />
            <Stop offset="1" stopColor="#081325" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
      </Svg>
      <Animated.View style={[{ position: 'absolute', left: width * 0.18, top: -height * 0.02 }, lightStyle]}>
        <Window w={width * 0.95} h={height * 0.78} />
      </Animated.View>
      {motes.map((m, i) => (
        <Mote key={i} {...m} reduce={reduce} />
      ))}
      <Animated.View style={[{ position: 'absolute', right: -width * 0.06, top: height * 0.04, transformOrigin: 'top left' }, branchStyle]}>
        <Branch size={width * 0.45} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, birdStyle]}>
        <Bird />
      </Animated.View>
      <Fade colors={['rgba(3,8,18,0.55)', 'rgba(0,0,0,0)', 'rgba(3,8,18,0.7)']} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
    </View>
  );
}

export type _Unused = SharedValue<number>;
