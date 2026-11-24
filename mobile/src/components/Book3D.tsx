// One book as a real 3D object you can spin all the way around with a finger.
// Faces use the reader's own photos when they took them (front / back / spine),
// otherwise the Open Library cover and the server-drawn gold-foil spine.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import BookCover from '@/components/BookCover';
import { Canvas, useFrame } from '@react-three/fiber';
import { useIsFocused } from 'expo-router';
import * as THREE from 'three';

import { Book, coverFor } from '@/api';
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
  const T = 0.18 + Math.min(1000, book.pages || 320) / 1000 * 0.42;
  const hard = /hard|cloth|leather|board/i.test(book.binding || '') ;

  // A real book, not a box: cover boards (+z front, -z back), a page block with
  // paper edges, and the spine on the left (-x) — rounded for hardcovers.
  const C = hard ? 0.04 : 0.014;      // board thickness
  const O = hard ? 0.055 : 0.0;       // how far the boards overhang the pages
  const mats = useMemo(() => {
    const m = (c: string, r = 0.75) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.02 });
    const board = () => [m(cloth), m(cloth), m(cloth), m(cloth), m(cloth, 0.55), m(cloth, 0.6)];
    return {
      front: board(),
      back: board(),
      pages: [m('#EFE6D2', 0.95), m('#EFE6D2', 0.95), m('#EFE6D2', 0.95), m('#EFE6D2', 0.95), m('#EFE6D2', 0.95), m('#EFE6D2', 0.95)],
      spine: m(cloth, 0.6),
    };
  }, [cloth]);
  useEffect(() => {
    const put = (mm: THREE.MeshStandardMaterial, t: THREE.Texture | null) => {
      mm.map = t;
      mm.color.set(t ? '#ffffff' : cloth);
      mm.needsUpdate = true;
    };
    put(mats.front[4], front);         // outside of the front board faces +z
    put(mats.back[5], back);           // outside of the back board faces -z
    put(mats.spine, spine);
    mats.pages.forEach((mm) => {
      mm.map = pages;
      mm.color.set('#ffffff');
      mm.needsUpdate = true;
    });
  }, [front, back, spine, pages, mats, cloth]);
  // the spine image reads top-to-bottom across the curved (or flat) spine
  useEffect(() => {
    if (!spine) return;
    spine.wrapS = THREE.RepeatWrapping;
    spine.needsUpdate = true;
  }, [spine]);

  useFrame((state, dt) => {
    const s = spin.current;
    if (!spinnable) {
      // only the front was photographed (or none): stand still, cover forward, breathing gently
      if (g.current) {
        g.current.rotation.y = 0.32 + Math.sin(state.clock.elapsedTime * 0.6) * 0.16;
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

  const pageW = W - O - (hard ? 0.02 : 0);
  return (
    <>
      <group ref={g}>
        {/* front and back boards */}
        <mesh material={mats.front} position={[0, 0, T / 2 - C / 2]}>
          <boxGeometry args={[W, H, C]} />
        </mesh>
        <mesh material={mats.back} position={[0, 0, -T / 2 + C / 2]}>
          <boxGeometry args={[W, H, C]} />
        </mesh>
        {/* the text block, set back from the edges of the boards */}
        <mesh material={mats.pages} position={[-W / 2 + (hard ? 0.02 : 0) + pageW / 2, 0, 0]}>
          <boxGeometry args={[pageW, H - 2 * O, T - 2 * C + 0.002]} />
        </mesh>
        {/* the spine: rounded and proud for a hardcover, flat for a paperback */}
        {hard ? (
          <mesh material={mats.spine} position={[-W / 2, 0, 0]} scale={[0.55, 1, 1]}>
            <cylinderGeometry args={[T / 2, T / 2, H, 28, 1, true, Math.PI, Math.PI]} />
          </mesh>
        ) : (
          <mesh material={mats.spine} position={[-W / 2 - 0.001, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
            <planeGeometry args={[T, H]} />
          </mesh>
        )}
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
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) setReady(false); // show the 2D cover again while the 3D view comes back
  }, [focused]);
  // start three-quarter on, so cover and spine both show
  const spin = useRef<Spin>({ y: 0.45, x: 0.08, vy: 0, dragging: false });
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
          <BookCover title={book.title} author={book.author} uri={coverFor(book)} width={height * 0.42} />
        </View>
      )}
      {/* give the GL context back while another screen (the busts, a reader) covers this one */}
      {focused && (
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
      )}
    </View>
  );
}
