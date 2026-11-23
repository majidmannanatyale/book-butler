// Photo studio: (re)take a book's front, back and spine. Each photo is sent to the
// server, which finds the book (AI) and snaps to its edges (OpenCV), so the 3D
// model wears just the book — no hand, no table.
import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { IconClose } from '@/components/Icons';
import { bumpTex, texUrl } from '@/components/tex';
import { Button, Caps, ErrorNote, Italic, tap } from '@/components/ui';
import { api, Book, bookCache, getBase } from '@/api';
import { colors, fonts } from '@/theme';

type Side = 'front' | 'back' | 'spine';
const SIDES: { side: Side; label: string; hint: string }[] = [
  { side: 'front', label: 'Front', hint: 'Hold the front cover square to the camera. Fingers on the edges are fine — we cut them out.' },
  { side: 'back', label: 'Back', hint: 'Turn it over and fill the frame with the back cover.' },
  { side: 'spine', label: 'Spine', hint: 'Turn it on its side and line the spine up with the guide.' },
];

export default function PhotoStudio() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [book, setBook] = useState<Book | null>(() => bookCache.get(Number(id)) ?? null);
  const [base, setBase] = useState('');
  const [side, setSide] = useState<Side>('front');
  const [busy, setBusy] = useState<Side | null>(null);
  const [error, setError] = useState('');
  const [stamp, setStamp] = useState<Record<string, number>>({});

  useEffect(() => {
    getBase().then(setBase);
    api.book(Number(id)).then(setBook).catch((e) => setError(e.message));
  }, [id]);

  const shoot = async () => {
    if (!cam.current || busy) return;
    tap();
    setError('');
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.7, base64: true, shutterSound: false });
      if (!pic?.base64) return;
      setBusy(side);
      const b = await api.uploadFace(Number(id), side, pic.base64);
      bumpTex(b.id);
      setBook(b);
      setStamp((s) => ({ ...s, [side]: Date.now() }));
      const nextSide = SIDES.find((x) => !(b.faces || []).includes(x.side));
      if (nextSide) setSide(nextSide.side);
    } catch (e: any) {
      setError(e?.message || 'Could not save that photo.');
    }
    setBusy(null);
  };

  const current = SIDES.find((x) => x.side === side)!;
  const have = book?.faces || [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper, paddingTop: insets.top + 10 }}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <Caps>Photo studio</Caps>
          <Text style={s.title} numberOfLines={1}>{book?.title || ' '}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Done">
          <IconClose color={colors.ink} />
        </Pressable>
      </View>

      <View style={s.tabs}>
        {SIDES.map((x) => (
          <Pressable key={x.side} onPress={() => { tap(); setSide(x.side); }} style={[s.tab, side === x.side && s.tabOn]} accessibilityState={{ selected: side === x.side }}>
            <View style={s.thumbBox}>
              {base && book && have.includes(x.side) ? (
                <Image source={{ uri: `${texUrl(base, book, x.side)}&t=${stamp[x.side] || 0}` }} style={s.thumb} resizeMode="contain" />
              ) : (
                <Text style={{ color: colors.sepia, fontSize: 20 }}>+</Text>
              )}
              {busy === x.side && <View style={s.thumbBusy}><Caps style={{ fontSize: 8, color: colors.gold }}>cutting out…</Caps></View>}
            </View>
            <Caps style={{ fontSize: 9, color: side === x.side ? colors.gold : colors.inkSoft }}>{`${x.label}${have.includes(x.side) ? ' ✓' : ''}`}</Caps>
          </Pressable>
        ))}
      </View>

      <View style={s.camWrap}>
        {permission?.granted ? (
          <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
            <Button label="Allow camera" onPress={requestPermission} />
          </View>
        )}
        <View pointerEvents="none" style={[s.guide, side === 'spine' ? s.guideSpine : s.guideCover]} />
      </View>
      <Animated.View key={side} entering={FadeInDown.duration(300)} style={{ paddingHorizontal: 22, paddingTop: 10 }}>
        <Italic style={{ fontSize: 14.5, textAlign: 'center' }}>{current.hint}</Italic>
      </Animated.View>
      {!!error && <ErrorNote message={error} />}
      <View style={[s.bottom, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <Pressable onPress={shoot} disabled={!!busy || !permission?.granted} style={[s.shutter, busy && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={`Photograph the ${current.label}`}>
          <View style={s.shutterIn} />
        </Pressable>
        {['front', 'back', 'spine'].every((f) => have.includes(f)) && (
          <Animated.View entering={FadeIn}>
            <Button label="See it in 3D" kind="outline" onPress={() => router.back()} style={{ marginTop: 10 }} />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 10 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 10 },
  tab: { alignItems: 'center', gap: 6, padding: 6, borderWidth: 1, borderColor: 'transparent' },
  tabOn: { borderColor: 'rgba(242,181,58,0.6)' },
  thumbBox: { width: 58, height: 80, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: '100%', height: '100%' },
  thumbBusy: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,19,37,0.75)', alignItems: 'center', justifyContent: 'center' },
  camWrap: { flex: 1, marginHorizontal: 16, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  guide: { borderWidth: 1.5, borderColor: 'rgba(242,181,58,0.85)', borderStyle: 'dashed' },
  guideCover: { width: '66%', aspectRatio: 0.68 },
  guideSpine: { width: '20%', height: '80%' },
  bottom: { alignItems: 'center', paddingTop: 12 },
  shutter: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  shutterIn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.gold },
});
