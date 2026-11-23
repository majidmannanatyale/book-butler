// One book as a real 3D object you can spin all the way around with a finger.
// Faces use the reader's own photos when they took them (front / back / spine),
// otherwise the Open Library cover and the server-drawn gold-foil spine.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import BookCover from '@/components/BookCover';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { Book } from '@/api';
import { pagesUrl, shadowTexture, texUrl, useTexture } from '@/components/tex';
import { colors } from '@/theme';

function clothColor(title: string) {
  const C = ['#182C4A', '#304E42', '#70282C', '#A9CDBE', '#E9DEC7', '#3A2C52', '#1E1E22', '#5C462C'];
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return C[h % C.length];
}

function useTex(url?: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        if (alive) setTex(t);
      },
      undefined,
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

type Spin = { y: number; x: number; vy: number; dragging: boolean };

function Model({ book, base, spin, spinnable }: { book: Book; base: string; spin: React.MutableRefObject<Spin>; spinnable: boolean }) {
  const g = useRef<THREE.Group>(null);
  const faces = book.faces || [];
  const front = useTexture(texUrl(base, book, 'front'));
  const back = useTexture(texUrl(base, book, 'back'));
  const spine = useTexture(texUrl(base, book, 'spine'));
  const pages = useTexture(pagesUrl(base));
  const cloth = clothColor(book.title);

  // proportions from the real book: height (cm) and page count -> thickness
  const H = 2.2 * Math.min(1.25, Math.max(0.8, (book.height_cm || 20) / 20));
  const W = H * 0.66;
  const T = 0.22 + Math.min(1000, book.pages || 320) / 1000 * 0.45;

  // BoxGeometry faces: 0 +x page edges, 1 -x spine, 2 top, 3 bottom, 4 +z front cover, 5 -z back cover
  const mats = useMemo(() => {
    const m = (c: string, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.02 });
    return [m('#EFE6D2', 0.95), m(cloth), m('#EFE6D2', 0.95), m('#EFE6D2', 0.95), m(cloth, 0.6), m(cloth, 0.7)];
  }, [cloth]);
  useEffect(() => {
    const set = (i: number, t: THREE.Texture | null) => {
      mats[i].map = t;
      mats[i].color.set(t ? '#ffffff' : cloth);
      mats[i].needsUpdate = true;
    };
    set(4, front);
    set(5, back);
    set(1, spine);
    [0, 2, 3].forEach((i) => {
      mats[i].map = pages;
      mats[i].needsUpdate = true;
    });
  }, [front, back, spine, pages, mats, cloth]);

  useFrame((state, dt) => {
    const s = spin.current;
    if (!spinnable) {
      // only the front was photographed (or none): stand still, cover forward, breathing gently
      if (g.current) {
        g.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.18;
        g.current.rotation.x = 0.04;
      }
      return;
    }
    if (!s.dragging) {
      s.y += s.vy * dt;
      s.vy *= Math.pow(0.12, dt); // inertia that settles
      if (Math.abs(s.vy) < 0.15) s.y += 0.25 * dt; // gentle idle turn
      s.x *= Math.pow(0.2, dt);
    }
    if (g.current) {
      g.current.rotation.y = s.y;
      g.current.rotation.x = s.x;
    }
  });

  return (
    <>
      <group ref={g}>
        <mesh material={mats}>
          <boxGeometry args={[T, H, W]} />
        </mesh>
      </group>
      <mesh position={[0, -H / 2 - 0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W * 2.2, W * 1.1]} />
        <meshBasicMaterial map={shadowTexture()} transparent opacity={0.85} depthWrite={false} />
      </mesh>
    </>
  );
}

export default function Book3D({ book, base, height = 330 }: { book: Book; base: string; height?: number }) {
  // Spin all the way round only when we truly have every side (the reader's own photos).
  const faces = book.faces || [];
  const spinnable = ['front', 'back', 'spine'].every((f) => faces.includes(f));
  const [ready, setReady] = useState(false);
  // start three-quarter on, so cover and spine both show
  const spin = useRef<Spin>({ y: spinnable ? -Math.PI / 2 + 0.5 : 0, x: 0.08, vy: 0, dragging: false });
  const last = useRef({ dx: 0, t: 0 });
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          spin.current.dragging = true;
          spin.current.vy = 0;
          last.current = { dx: 0, t: Date.now() };
        },
        onPanResponderMove: (_, gs) => {
          const d = gs.dx - last.current.dx;
          const now = Date.now();
          spin.current.y += d * 0.012; // full 360° with a long swipe
          spin.current.x = Math.max(-0.45, Math.min(0.45, gs.dy * 0.004));
          spin.current.vy = (d * 0.012) / Math.max(0.016, (now - last.current.t) / 1000);
          last.current = { dx: gs.dx, t: now };
        },
        onPanResponderRelease: () => {
          spin.current.dragging = false;
        },
        onPanResponderTerminate: () => {
          spin.current.dragging = false;
        },
      }),
    [],
  );
  return (
    <View style={{ height }} {...(spinnable ? pan.panHandlers : {})}>
      {!ready && (
        // instant 2D cover while the 3D scene spins up
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <BookCover title={book.title} author={book.author} uri={book.cover_url} width={height * 0.42} />
        </View>
      )}
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ fov: 35, position: [0, 0.2, 6.2] }}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        onCreated={() => setTimeout(() => setReady(true), 250)}
      >
        <ambientLight intensity={0.65} color="#A9CDBE" />
        <directionalLight position={[1.5, 2.5, 6]} intensity={1.9} color="#FFE9C2" />
        <directionalLight position={[-3, 1, -4]} intensity={0.5} color="#9FC3F0" />
        <pointLight position={[0, 3, 2]} intensity={5} distance={8} color="#F2B53A" />
        <Model book={book} base={base} spin={spin} spinnable={spinnable} />
      </Canvas>
    </View>
  );
}
