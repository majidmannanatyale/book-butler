// Speak to the Librarian: on-device speech-to-text (Android SpeechRecognizer,
// or the browser's speech API on web). Words stream into the box as you talk;
// when you stop, the question is sent. Hidden where speech isn't available.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { tap } from '@/components/ui';
import { colors } from '@/theme';

let Speech: any = null;
try {
  Speech = require('expo-speech-recognition').ExpoSpeechRecognitionModule;
  if (Speech && typeof Speech.isRecognitionAvailable === 'function' && !Speech.isRecognitionAvailable()) Speech = null;
} catch {
  Speech = null; // older build / Expo Go — no native speech module
}

export const micAvailable = () => !!Speech;

export default function MicButton({ onPartial, onFinal }: { onPartial: (t: string) => void; onFinal: (t: string) => void }) {
  const [on, setOn] = useState(false);
  const last = useRef('');
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!Speech) return;
    const subs = [
      Speech.addListener('result', (e: any) => {
        const t = e?.results?.[0]?.transcript || '';
        last.current = t;
        onPartial(t);
        if (e?.isFinal && t) onFinal(t);
      }),
      Speech.addListener('end', () => setOn(false)),
      Speech.addListener('error', () => setOn(false)),
    ];
    return () => subs.forEach((s: any) => s?.remove?.());
  }, [onPartial, onFinal]);

  useEffect(() => {
    pulse.value = on ? withRepeat(withTiming(1.35, { duration: 650 }), -1, true) : withTiming(1);
  }, [on]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: on ? 0.5 : 0 }));

  if (!Speech) return null;

  const toggle = async () => {
    tap();
    if (on) {
      Speech.stop();
      return;
    }
    const perm = await Speech.requestPermissionsAsync();
    if (!perm?.granted) return;
    last.current = '';
    setOn(true);
    Speech.start({ lang: 'en-US', interimResults: true, continuous: false });
  };

  return (
    <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={on ? 'Stop listening' : 'Ask by voice'} hitSlop={8} style={s.wrap}>
      <Animated.View style={[s.ring, ring]} />
      <View style={[s.btn, on && { backgroundColor: colors.gold }]}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={on ? colors.paper : colors.gold} strokeWidth={1.6}>
          <Rect x="9" y="3" width="6" height="11" rx="3" />
          <Path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
          <Line x1="12" y1="17.5" x2="12" y2="21" />
        </Svg>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold },
  btn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
});
