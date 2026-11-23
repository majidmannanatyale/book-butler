// Add a book with the camera: a guided capture of the FRONT, BACK and SPINE.
// The Cataloguer reads all three in one call (title, author, edition, ISBN from
// the barcode area). Old book with no ISBN? It asks for the title / copyright
// page. The three photos become the book's 3D model in the library.
import React, { useRef, useState } from 'react';
import { Image as RNImage, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Button, Caps, ErrorNote, Italic, tap } from '@/components/ui';
import { api, Draft, money } from '@/api';
import { colors, fonts } from '@/theme';

type Side = 'front' | 'back' | 'spine' | 'page';
type Shot = { uri: string; b64: string };

const STEPS: { side: Side; label: string; hint: string; guide: 'cover' | 'spine' | 'page' }[] = [
  { side: 'front', label: 'Front cover', hint: 'Fill the frame with the front cover.', guide: 'cover' },
  { side: 'back', label: 'Back cover', hint: 'Turn it over — the barcode area often has the ISBN.', guide: 'cover' },
  { side: 'spine', label: 'Spine', hint: 'Turn it on its side and line up the spine.', guide: 'spine' },
];

export default function GuidedCamera({
  onRead,
}: {
  onRead: (r: { draft: Draft; verified: boolean; cost: number; shots: Partial<Record<Side, Shot>> }) => void;
}) {
  const focused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState<Partial<Record<Side, Shot>>>({});
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<'capture' | 'reading' | 'page'>('capture');
  const [ask, setAsk] = useState('');
  const [error, setError] = useState('');

  const current: (typeof STEPS)[number] | { side: Side; label: string; hint: string; guide: 'page' } =
    phase === 'page' ? { side: 'page', label: 'Title or copyright page', hint: ask, guide: 'page' } : STEPS[Math.min(step, STEPS.length - 1)];

  const read = async (all: Partial<Record<Side, Shot>>) => {
    setPhase('reading');
    setError('');
    try {
      const r = await api.catalogueMulti({
        front: all.front?.b64,
        back: all.back?.b64,
        spine: all.spine?.b64,
        page: all.page?.b64,
      });
      if (r.draft.needs_info_page && !all.page) {
        setAsk(r.draft.ask || 'No ISBN found — please photograph the title page or the copyright page.');
        setPhase('page');
        return;
      }
      onRead({ draft: r.draft, verified: r.verified, cost: r.usage.cost_usd, shots: all });
    } catch (e: any) {
      setError(e.message);
      setPhase('capture');
    }
  };

  const shoot = async () => {
    if (!cam.current) return;
    tap();
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.6, base64: true, shutterSound: false });
      if (!pic) return;
      const shot = { uri: pic.uri, b64: pic.base64 || pic.uri };
      const next = { ...shots, [current.side]: shot };
      setShots(next);
      if (phase === 'page') return read(next);
      if (step + 1 >= STEPS.length) return read(next);
      setStep(step + 1);
    } catch (e: any) {
      setError(e?.message || 'Could not take the photo.');
    }
  };

  const skip = () => {
    tap();
    if (phase === 'page') return read(shots);
    if (step + 1 >= STEPS.length) return read(shots);
    setStep(step + 1);
  };

  if (!permission?.granted) return <Button label="Allow camera" onPress={requestPermission} />;

  return (
    <View>
      {/* progress: 1 front · 2 back · 3 spine */}
      <View style={s.steps}>
        {STEPS.map((st, i) => {
          const done = !!shots[st.side];
          const on = phase === 'capture' && i === step;
          return (
            <Pressable key={st.side} onPress={() => phase !== 'reading' && setStep(i)} style={s.stepItem}>
              <View style={[s.stepDot, done && { backgroundColor: colors.gold, borderColor: colors.gold }, on && { borderColor: colors.gold }]}>
                {shots[st.side] ? <RNImage source={{ uri: shots[st.side]!.uri }} style={s.thumb} /> : <Text style={s.stepNum}>{i + 1}</Text>}
              </View>
              <Caps style={{ fontSize: 8.5, color: on ? colors.gold : colors.sepia }}>{st.label}</Caps>
            </Pressable>
          );
        })}
      </View>

      <View style={s.camWrap}>
        {focused && <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" animateShutter={false} onCameraReady={() => setReady(true)} />}
        {/* framing guide */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[s.guide, current.guide === 'spine' ? s.guideSpine : current.guide === 'page' ? s.guidePage : s.guideCover]} />
        </View>
        <View style={s.camLabel}>
          <Caps color={colors.gold}>{phase === 'page' ? 'One more photo' : `${step + 1} of 3 · ${current.label}`}</Caps>
          <Italic color={colors.wallText} style={{ fontSize: 15, marginTop: 2 }}>{current.hint}</Italic>
        </View>
        {phase === 'reading' && (
          <Animated.View entering={FadeIn} style={[StyleSheet.absoluteFill, s.readingVeil]}>
            <Italic color={colors.wallText} style={{ fontSize: 18 }}>The cataloguer is reading your book…</Italic>
          </Animated.View>
        )}
      </View>

      {!!error && <ErrorNote message={error} />}
      {phase === 'page' && (
        <Animated.View entering={FadeInDown} style={s.askBox}>
          <Caps color={colors.gold}>Older book? No ISBN found</Caps>
          <Italic style={{ fontSize: 15, marginTop: 4 }}>{ask}</Italic>
        </Animated.View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 14 }}>
        <Pressable onPress={skip} disabled={phase === 'reading' || (phase === 'capture' && step === 0)} hitSlop={10} style={{ opacity: phase === 'capture' && step === 0 ? 0.3 : 1 }}>
          <Caps>{phase === 'page' ? 'Skip' : 'Skip side'}</Caps>
        </Pressable>
        <Pressable onPress={shoot} disabled={!ready || phase === 'reading'} accessibilityLabel={`Photograph the ${current.label}`} style={[s.shutter, (!ready || phase === 'reading') && { opacity: 0.4 }]}>
          <View style={s.shutterInner} />
        </Pressable>
        <View style={{ width: 60 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  steps: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 12 },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stepNum: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  thumb: { width: 44, height: 44 },
  camWrap: { height: 400, backgroundColor: colors.wall, overflow: 'hidden' },
  guide: { position: 'absolute', alignSelf: 'center', borderWidth: 1.5, borderColor: 'rgba(242,181,58,0.85)', borderStyle: 'dashed' },
  guideCover: { top: '14%', width: '58%', height: '72%' },
  guideSpine: { top: '10%', width: '16%', height: '80%' },
  guidePage: { top: '12%', width: '64%', height: '76%' },
  camLabel: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: 'rgba(5,13,26,0.72)' },
  readingVeil: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,13,26,0.72)' },
  askBox: { marginTop: 12, borderLeftWidth: 2, borderColor: colors.gold, paddingLeft: 12 },
  shutter: { width: 70, height: 70, borderRadius: 35, borderWidth: 1.5, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.gold },
});
