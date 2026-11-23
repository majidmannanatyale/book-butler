// "Read a sample": the opening line + description from Open Library, with a
// free full-text link for public-domain books (Internet Archive).
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Caps, Italic, tap } from '@/components/ui';
import { Sample } from '@/api';
import { colors, fonts } from '@/theme';

export default function SampleCard({ load, dark = true }: { load: () => Promise<Sample>; dark?: boolean }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [sample, setSample] = useState<Sample | null>(null);
  const ink = dark ? colors.wallText : colors.creamInk;
  const soft = dark ? colors.wallMuted : colors.creamSoft;

  const open = async () => {
    tap();
    setState('busy');
    try {
      setSample(await load());
      setState('done');
    } catch {
      setState('error');
    }
  };

  if (state === 'idle' || state === 'busy')
    return (
      <Pressable onPress={open} disabled={state === 'busy'} style={[s.btn, { borderColor: colors.gold }]} accessibilityRole="button">
        <Caps color={colors.gold}>{state === 'busy' ? 'Finding a sample…' : '❧  Read a sample'}</Caps>
      </Pressable>
    );
  if (state === 'error' || !sample || sample.kind === 'none')
    return <Italic color={soft} style={{ fontSize: 14, marginTop: 10 }}>No sample is available for this book yet.</Italic>;

  return (
    <Animated.View entering={FadeIn.duration(500)} style={{ marginTop: 14 }}>
      <Caps color={soft} style={{ fontSize: 9 }}>{`From ${sample.source}`}</Caps>
      {!!sample.opening && (
        <Text style={[s.opening, { color: ink }]}>
          <Text style={s.initial}>{sample.opening[0]}</Text>
          {sample.opening.slice(1)}
        </Text>
      )}
      {!!sample.text && <Text style={[s.body, { color: soft }]}>{sample.text}</Text>}
      {!!sample.link && (
        <Pressable onPress={() => Linking.openURL(sample.link!)} style={{ marginTop: 10 }}>
          <Caps color={colors.gold}>{sample.free ? 'Read the whole book free →' : 'More on Open Library →'}</Caps>
        </Pressable>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  btn: { marginTop: 14, borderWidth: 1, paddingVertical: 11, alignItems: 'center' },
  opening: { fontFamily: fonts.displayItalic, fontSize: 19, lineHeight: 26, marginTop: 8 },
  initial: { fontFamily: fonts.script, fontSize: 34, color: colors.gold },
  body: { fontFamily: fonts.body, fontSize: 14.5, lineHeight: 21, marginTop: 10 },
});
