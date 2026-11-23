// The Book Butler mark — "Spine of light": a gilt-banded spine between two
// shadowed neighbours, a sliver of lamplight down its middle, dust in the beam.
// The light gently breathes and the motes drift, like the Book Finder.
import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Rect } from 'react-native-svg';

import { colors } from '@/theme';

const ARect = Animated.createAnimatedComponent(Rect);
const ACircle = Animated.createAnimatedComponent(Circle);

export default function Logo({ size = 56, tile = false, animated = true }: { size?: number; tile?: boolean; animated?: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (animated) t.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [animated]);
  const beam = useAnimatedProps(() => ({ opacity: 0.65 + 0.35 * t.value }));
  const m1 = useAnimatedProps(() => ({ cy: 22 - 6 * t.value, opacity: 0.4 + 0.6 * t.value }));
  const m2 = useAnimatedProps(() => ({ cy: 14 - 4 * t.value, opacity: 1 - 0.6 * t.value }));

  return (
    <Svg width={size} height={size} viewBox="0 0 140 140" accessibilityLabel="The Book Butler">
      {tile && <Rect x={0} y={0} width={140} height={140} rx={28} fill={colors.paper} />}
      <Rect x={30} y={38} width={20} height={78} rx={2} fill="#16294A" />
      <Rect x={90} y={34} width={22} height={82} rx={2} fill="#16294A" />
      <Rect x={56} y={26} width={28} height={90} rx={3} fill="#1E3456" stroke={colors.gold} strokeWidth={1.2} />
      <G stroke={colors.gold} strokeWidth={1}>
        <Line x1={60} y1={36} x2={80} y2={36} />
        <Line x1={60} y1={40} x2={80} y2={40} />
        <Line x1={60} y1={102} x2={80} y2={102} />
        <Line x1={60} y1={106} x2={80} y2={106} />
      </G>
      <ARect x={68.5} y={16} width={3} height={104} rx={1.5} fill={colors.gold} animatedProps={beam} />
      <ACircle cx={62} r={1.6} fill={colors.goldBright} animatedProps={m1} />
      <ACircle cx={79} r={1.3} fill={colors.goldBright} animatedProps={m2} />
      <Circle cx={74} cy={28} r={1.1} fill={colors.goldBright} />
      <Rect x={24} y={116} width={92} height={3} rx={1.5} fill={colors.owned} />
    </Svg>
  );
}
