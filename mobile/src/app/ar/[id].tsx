// "Bring them to life": a book's characters as antique marble busts, standing in
// your room through the camera. Tilt the phone and the bust holds its place
// (gyro parallax); drag to turn it. Keep one as decor on your 3D bookcase.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import Bust, { BUST_CREDIT, Look } from '@/components/Bust';
import { IconClose } from '@/components/Icons';
import { shadowTexture } from '@/components/tex';
import { Button, Caps, ErrorNote, Italic, tap } from '@/components/ui';
import { api, Book, bookCache } from '@/api';
import { colors, fonts } from '@/theme';

let Motion: any = null;
try {
  Motion = require('expo-sensors').DeviceMotion;
} catch {
  Motion = null; // older build: no gyro parallax, drag still works
}

type Ch = { name: string; epithet: string; line: string; look: Look };
type Pose = { yaw: number; pitch: number; spin: number; vy: number; dragging: boolean };

function Motes() {
  // a few dust motes drifting up through the light, like the Book Finder
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(40 * 3);
    for (let i = 0; i < 40; i++) {
      p[i * 3] = (Math.random() - 0.5) * 1.8;
      p[i * 3 + 1] = Math.random() * 2.4 - 0.4;
      p[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  useFrame((_, dt) => {
    const a = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) + dt * 0.08;
      if (y > 2.1) y = -0.4;
      a.setY(i, y);
    }
    a.needsUpdate = true;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial color="#F7C863" size={0.025} transparent opacity={0.7} depthWrite={false} />
    </points>
  );
}

function Stage({ look, pose, seed }: { look: Look; pose: React.MutableRefObject<Pose>; seed: number }) {
  const g = useRef<THREE.Group>(null);
  const rise = useRef(0);
  useFrame((state, dt) => {
    const p = pose.current;
    if (!p.dragging) {
      p.spin += p.vy * dt;
      p.vy *= Math.pow(0.15, dt);
      if (Math.abs(p.vy) < 0.1) p.spin += Math.sin(state.clock.elapsedTime * 0.4) * 0.002;
    }
    rise.current = Math.min(1, rise.current + dt * 1.4);
    const e = 1 - Math.pow(1 - rise.current, 3);
    if (g.current) {
      // the world counter-rotates against the phone's tilt, so the bust seems to stay put in the room
      g.current.rotation.y = p.spin - p.yaw * 0.6;
      g.current.rotation.x = -p.pitch * 0.25;
      g.current.position.y = -0.95 - (1 - e) * 0.5;
      g.current.scale.setScalar(0.92 + e * 0.08);
    }
  });
  return (
    <group ref={g}>
      <Bust look={look} seed={seed} />
      <mesh position={[0, -0.375, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2.2, 1.8]} />
        <meshBasicMaterial map={shadowTexture()} transparent opacity={0.75} depthWrite={false} />
      </mesh>
    </group>
  );
}

export default function ARCharacters() {
  const { id, title: pTitle, author: pAuthor } = useLocalSearchParams<{ id?: string; title?: string; author?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const book: Book | undefined = id ? bookCache.get(Number(id)) : undefined;
  const title = book?.title || pTitle || '';
  const author = book?.author || pAuthor || '';
  const [cast, setCast] = useState<Ch[] | null>(null);
  const [i, setI] = useState(0);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Record<number, boolean>>({});
  const [useCam, setUseCam] = useState(Platform.OS !== 'web');
  const pose = useRef<Pose>({ yaw: 0, pitch: 0, spin: -0.35, vy: 0, dragging: false });

  useEffect(() => {
    if (!title) return;
    api
      .characters(title, author)
      .then((r) => setCast(r.characters))
      .catch((e) => setError(e.message));
  }, [title, author]);

  useEffect(() => {
    if (!Motion) return;
    let sub: any;
    try {
      Motion.setUpdateInterval(33);
      sub = Motion.addListener((m: any) => {
        const r = m?.rotation;
        if (!r) return;
        // smooth toward the phone's current yaw (alpha) and pitch (beta, ~upright = π/2)
        const p = pose.current;
        p.yaw += ((r.gamma || 0) - p.yaw) * 0.2;
        p.pitch += (((r.beta || Math.PI / 2) - Math.PI / 2) - p.pitch) * 0.2;
      });
    } catch {}
    return () => sub?.remove?.();
  }, []);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          pose.current.dragging = true;
          pose.current.vy = 0;
        },
        onPanResponderMove: (_, g) => {
          pose.current.spin += g.vx * 0.06;
          pose.current.vy = g.vx * 2.4;
        },
        onPanResponderRelease: () => {
          pose.current.dragging = false;
        },
      }),
    [],
  );

  const ch = cast?.[i];
  const keep = async () => {
    if (!ch) return;
    tap();
    try {
      await api.addDecor({ book_id: id ? Number(id) : null, book_title: title, character: ch });
      setSaved((s) => ({ ...s, [i]: true }));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const camOn = useCam && permission?.granted;
  return (
    <View style={{ flex: 1, backgroundColor: '#05080F' }}>
      {camOn ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.wall }]} />
      )}
      {/* a pool of museum light where the bust stands */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.vignette]} />

      <View style={{ flex: 1 }} {...pan.panHandlers}>
        {ch && (
          <Canvas
            key={ch.name}
            dpr={[1, 2]}
            gl={{ antialias: true, alpha: true }}
            onCreated={({ gl }) => {
              gl.localClippingEnabled = true;
            }}
            camera={{ fov: 30, position: [0, 0.15, 5.2] }}
            style={{ flex: 1, backgroundColor: 'transparent' }}
          >
            <ambientLight intensity={0.45} color="#DDE6F0" />
            <directionalLight position={[2.5, 3, 3]} intensity={2.2} color="#FFF1D6" />
            <directionalLight position={[-3, 1.5, -2]} intensity={1.1} color="#A9CDBE" />
            <pointLight position={[0, 2.4, 1.2]} intensity={3} distance={6} color="#F2B53A" />
            <Stage look={ch.look} pose={pose} seed={i + 1} />
            <Motes />
          </Canvas>
        )}
      </View>

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Caps style={{ color: colors.gold }}>Characters · in your room</Caps>
          <Text style={s.book} numberOfLines={1}>{title}</Text>
        </View>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Close">
          <IconClose color="#fff" />
        </Pressable>
      </View>

      {!cast && !error && (
        <Animated.View entering={FadeIn} style={s.center} pointerEvents="none">
          <Italic style={{ color: '#fff', textAlign: 'center' }}>The sculptor is at work…</Italic>
        </Animated.View>
      )}
      {cast && !cast.length && (
        <View style={s.center}>
          <Italic style={{ color: '#fff', textAlign: 'center' }}>The sculptor doesn't know this book's characters well enough to carve them — better nothing than a guess.</Italic>
        </View>
      )}
      {!!error && <ErrorNote dark message={error} />}

      {ch && (
        <Animated.View key={ch.name} entering={FadeInDown.duration(450)} style={[s.placard, { marginBottom: Math.max(insets.bottom, 12) }]}>
          <Text style={s.name}>{ch.name.toUpperCase()}</Text>
          <Text style={s.epithet}>{ch.epithet}</Text>
          <Text style={s.line}>{`“${ch.line}”`}</Text>
          <Text style={s.small}>{`Marble, after the classical manner · an original line in their spirit · ${BUST_CREDIT}`}</Text>
          <ScrollView horizontal style={{ flexGrow: 0 }} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingTop: 10 }}>
            {cast!.map((c, k) => (
              <Pressable key={c.name} onPress={() => { tap(); setI(k); }} style={[s.pill, k === i && s.pillOn]}>
                <Text style={[s.pillText, k === i && { color: colors.cream }]}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Button
              label={saved[i] ? 'On your shelf ✓' : 'Place on my shelf'}
              cream
              disabled={!!saved[i]}
              onPress={keep}
              style={{ flex: 1 }}
            />
            {Platform.OS !== 'web' && (
              <Button
                label={camOn ? 'Gallery' : 'Camera'}
                kind="outline"
                cream
                onPress={() => {
                  tap();
                  if (!permission?.granted) requestPermission();
                  setUseCam((u) => !u || !permission?.granted);
                }}
                style={{ flex: 0.6 }}
              />
            )}
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12, backgroundColor: 'rgba(5,8,15,0.45)' },
  book: { fontFamily: fonts.display, fontSize: 22, color: '#fff' },
  vignette: { borderWidth: 60, borderColor: 'rgba(0,0,0,0.25)' },
  center: { position: 'absolute', left: 30, right: 30, top: '42%' },
  placard: { marginHorizontal: 16, backgroundColor: colors.cream, padding: 16 },
  name: { fontFamily: fonts.display, fontSize: 14, letterSpacing: 3, color: colors.creamInk },
  epithet: { fontFamily: fonts.bodyItalic, fontSize: 15, color: colors.creamSoft, marginTop: 2 },
  line: { fontFamily: fonts.displayItalic, fontSize: 19, color: colors.creamInk, marginTop: 8, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: 10.5, color: colors.creamSoft, marginTop: 6, opacity: 0.8 },
  pill: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.creamSoft, paddingVertical: 6, paddingHorizontal: 10 },
  pillOn: { backgroundColor: colors.creamInk, borderColor: colors.creamInk },
  pillText: { fontFamily: fonts.body, fontSize: 13, color: colors.creamInk },
});
