// The collection as a real bookcase, in 3D (three.js via React Three Fiber).
// Each book is a model sized from its height (cm) and page count, wearing its
// spine artwork (drawn by the server) on the front and its cover on the side.
// Tap a book: it slides off the shelf toward you and turns to show its cover.
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { pagesUrl, texUrl, useTexture } from '@/components/tex';
import * as THREE from 'three';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { api, Book, Decor } from '@/api';
import Bust from '@/components/Bust';
import { Caps, Italic, tap } from '@/components/ui';
import { colors, fonts } from '@/theme';

const SHELF_W = 2.3; // inner width of one shelf (scene units ≈ 10 cm)
const SHELF_GAP = 1.4; // vertical distance between shelves
const DEPTH = 0.62;

type Placed = { book: Book; x: number; y: number; w: number; h: number; lean: number; i: number };

function layout(books: Book[]): { placed: Placed[]; rows: number } {
  const placed: Placed[] = [];
  let row = 0;
  let x = -SHELF_W / 2;
  books.forEach((b, i) => {
    const h = Math.min(1.25, Math.max(0.8, (b.height_cm || 20) / 20));
    const w = 0.11 + Math.min(1000, b.pages || 320) / 1000 * 0.2;
    if (x + w > SHELF_W / 2) {
      row += 1;
      x = -SHELF_W / 2;
    }
    placed.push({ book: b, x: x + w / 2, y: -row * SHELF_GAP + h / 2, w, h, lean: 0, i });
    x += w + 0.012;
  });
  // the last book on each row leans gently against its neighbour
  const rows = row + 1;
  for (let r = 0; r < rows; r++) {
    const inRow = placed.filter((p) => Math.round((p.y - p.h / 2) / -SHELF_GAP) === r);
    const last = inRow[inRow.length - 1];
    if (last && inRow.length > 3 && last.x + last.w / 2 < SHELF_W / 2 - 0.25) {
      last.lean = -0.16;
      last.x += 0.06;
    }
  }
  return { placed, rows };
}

function clothColor(title: string) {
  const C = ['#182C4A', '#304E42', '#70282C', '#A9CDBE', '#E9DEC7', '#3A2C52', '#1E1E22', '#5C462C'];
  let h = 0;
  for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return C[h % C.length];
}

/** Loads a texture; if it fails we simply keep the cloth colour. */
function useSafeTexture(url?: string | null) {
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

function BookMesh({
  p,
  base,
  selected,
  anySelected,
  onSelect,
  rows,
}: {
  p: Placed;
  base: string;
  selected: boolean;
  anySelected: boolean;
  onSelect: (id: number) => void;
  rows: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const faces = p.book.faces || [];
  const spine = useTexture(texUrl(base, p.book, 'spine'));
  // the cover and back load only once a book is taken off the shelf (then stay cached)
  const cover = useTexture(selected ? texUrl(base, p.book, 'front') : null);
  const back = useTexture(selected ? texUrl(base, p.book, 'back') : null);
  const pagesTex = useTexture(pagesUrl(base));
  const cloth = clothColor(p.book.title);
  const born = useRef<number | null>(null);
  const centerY = (-(rows - 1) * SHELF_GAP) / 2 + 1.1;

  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    if (born.current == null) born.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - born.current - p.i * 0.035;
    const drop = age < 0 ? 1 : Math.max(0, 1 - age / 0.6); // books drop onto the shelf one by one
    const k = 1 - Math.pow(0.001, dt); // smooth follow
    const tx = selected ? 0 : p.x;
    const ty = selected ? centerY : p.y + drop * drop * 1.2;
    const tz = selected ? 1.6 : anySelected ? -0.05 : 0;
    const ry = selected ? -Math.PI / 2 + Math.sin(state.clock.elapsedTime * 0.8) * 0.18 : 0;
    const s = selected ? 1.15 : 1;
    g.position.x += (tx - g.position.x) * k;
    g.position.y += (ty - g.position.y) * k;
    g.position.z += (tz - g.position.z) * k;
    g.rotation.y += (ry - g.rotation.y) * k;
    g.rotation.z += ((selected ? 0 : p.lean) - g.rotation.z) * k;
    g.scale.setScalar(g.scale.x + (s - g.scale.x) * k);
  });

  // BoxGeometry faces: 0 +x (front cover), 1 -x (back), 2 +y top, 3 -y bottom, 4 +z spine (towards you), 5 -z
  const mats = useMemo(() => {
    const cloth_ = () => new THREE.MeshStandardMaterial({ color: cloth, roughness: 0.78, metalness: 0.02 });
    const pages = () => new THREE.MeshStandardMaterial({ color: '#EFE6D2', roughness: 0.95 });
    return [cloth_(), cloth_(), pages(), pages(), cloth_(), pages()];
  }, [cloth]);
  useEffect(() => {
    [2, 3, 5].forEach((i) => {
      mats[i].map = pagesTex;
      mats[i].color.set('#ffffff');
      mats[i].needsUpdate = true;
    });
  }, [pagesTex, mats]);
  useEffect(() => {
    const m = mats[1];
    m.map = back;
    m.color.set(back ? '#ffffff' : cloth);
    m.needsUpdate = true;
  }, [back, mats, cloth]);
  useEffect(() => {
    const m = mats[4];
    m.map = spine;
    m.color.set(spine ? '#ffffff' : cloth);
    m.needsUpdate = true;
  }, [spine, mats, cloth]);
  useEffect(() => {
    const m = mats[0];
    m.map = cover;
    m.color.set(cover ? '#ffffff' : cloth);
    m.needsUpdate = true;
  }, [cover, mats, cloth]);

  return (
    <group ref={ref} position={[p.x, p.y + 1.2, 0]} rotation={[0, 0, p.lean]}>
      <mesh
        material={mats}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(p.book.id);
        }}
      >
        <boxGeometry args={[p.w, p.h, DEPTH]} />
      </mesh>
    </group>
  );
}

function Bookcase({ rows }: { rows: number }) {
  const wood = '#4A2F1B';
  const W = SHELF_W + 0.16;
  const H = rows * SHELF_GAP + 0.2;
  const topY = SHELF_GAP - 0.05;
  const midY = topY - H / 2;
  return (
    <group>
      {/* back panel */}
      <mesh position={[0, midY, -DEPTH / 2 - 0.04]}>
        <boxGeometry args={[W, H, 0.04]} />
        <meshStandardMaterial color="#0C1A2E" roughness={1} />
      </mesh>
      {/* sides */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * W) / 2, midY, 0]}>
          <boxGeometry args={[0.08, H + 0.1, DEPTH + 0.1]} />
          <meshStandardMaterial color={wood} roughness={0.7} />
        </mesh>
      ))}
      {/* shelves (one under each row, plus a top) */}
      {Array.from({ length: rows }, (_, r) => (
        <mesh key={r} position={[0, -r * SHELF_GAP - 0.03, 0]}>
          <boxGeometry args={[W, 0.06, DEPTH + 0.1]} />
          <meshStandardMaterial color={wood} roughness={0.65} />
        </mesh>
      ))}
      <mesh position={[0, topY, 0]}>
        <boxGeometry args={[W + 0.1, 0.08, DEPTH + 0.14]} />
        <meshStandardMaterial color={wood} roughness={0.65} />
      </mesh>
    </group>
  );
}

function DecorRow({ decor, onPick }: { decor: Decor[]; onPick: (d: Decor) => void }) {
  const topY = SHELF_GAP - 0.05 + 0.04;
  const n = decor.length;
  const S = 0.36;
  return (
    <group>
      {decor.map((d, i) => {
        const x = n === 1 ? 0 : -SHELF_W / 2 + 0.25 + (i * (SHELF_W - 0.5)) / (n - 1);
        return (
          <group
            key={d.id}
            position={[x, topY + 0.39 * S + 0.06, 0]}
            rotation={[0, -x * 0.25, 0]}
            scale={S}
            onClick={(e) => {
              e.stopPropagation();
              onPick(d);
            }}
          >
            <Bust look={d.look} seed={d.id} />
          </group>
        );
      })}
    </group>
  );
}

function Rig({ rows, selected, extraTop = 0 }: { rows: number; selected: boolean; extraTop?: number }) {
  const { camera, size } = useThree();
  useFrame((state) => {
    const aspect = size.width / size.height;
    const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const totalH = rows * SHELF_GAP + 0.6 + extraTop;
    const zH = totalH / (2 * Math.tan(fov / 2));
    const zW = (SHELF_W + 0.6) / (2 * Math.tan(fov / 2) * aspect);
    const z = Math.max(zH, zW) * (selected ? 0.82 : 1);
    const cy = (-(rows - 1) * SHELF_GAP) / 2 + 0.6 + extraTop / 2;
    const t = state.clock.elapsedTime;
    camera.position.x += (Math.sin(t * 0.25) * 0.35 - camera.position.x) * 0.05;
    camera.position.y += (cy + 0.25 - camera.position.y) * 0.05;
    camera.position.z += (z - camera.position.z) * 0.05;
    camera.lookAt(0, cy, 0);
  });
  return null;
}

export default function Shelf3D({ books, base, onOpen, readOnly = false, decor = [], onDecorChange }: { books: Book[]; base: string; onOpen: (id: number) => void; readOnly?: boolean; decor?: Decor[]; onDecorChange?: () => void }) {
  const [sel, setSel] = useState<number | null>(null);
  const [bust, setBust] = useState<Decor | null>(null);
  const { placed, rows } = useMemo(() => layout(books), [books]);
  const chosen = books.find((b) => b.id === sel);
  return (
    <View style={{ flex: 1 }}>
      <Canvas
        camera={{ fov: 38, position: [0, -1.5, 9] }}
        onPointerMissed={() => {
          setSel(null);
          setBust(null);
        }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
        }}
        style={{ flex: 1, backgroundColor: colors.paper }}
      >
        <color attach="background" args={[colors.paper]} />
        <fog attach="fog" args={[colors.paper, 9, 18]} />
        <ambientLight intensity={0.55} color="#A9CDBE" />
        <directionalLight position={[2, 4, 6]} intensity={1.1} color="#FFE6B0" />
        <pointLight position={[0, 1.2, 2.5]} intensity={6} distance={9} color="#F2B53A" />
        <pointLight position={[0, -3.5, 2.5]} intensity={4} distance={8} color="#F7C863" />
        <Suspense fallback={null}>
          <Bookcase rows={rows} />
          {placed.map((p) => (
            <BookMesh
              key={p.book.id}
              p={p}
              base={base}
              rows={rows}
              selected={sel === p.book.id}
              anySelected={sel != null}
              onSelect={(id) => {
                tap();
                setSel((cur) => (cur === id ? null : id));
              }}
            />
          ))}
        </Suspense>
        {decor.length > 0 && (
          <Suspense fallback={null}>
            <DecorRow
              decor={decor}
              onPick={(d) => {
                tap();
                setSel(null);
                setBust(d);
              }}
            />
          </Suspense>
        )}
        <Rig rows={rows} selected={sel != null} extraTop={decor.length ? 0.9 : 0} />
      </Canvas>
      {bust && !chosen ? (
        <Animated.View key={`b${bust.id}`} entering={FadeInDown.duration(400)} style={s.placard}>
          <Caps style={{ color: colors.creamSoft, fontSize: 9 }}>{`from ${bust.book_title}`}</Caps>
          <Text style={s.title}>{bust.name}</Text>
          <Text style={s.meta}>{bust.epithet}</Text>
          {!!bust.line && <Text style={[s.meta, { marginTop: 6 }]}>{`“${bust.line}”`}</Text>}
          {!readOnly && (
            <Pressable
              onPress={async () => {
                tap();
                await api.removeDecor(bust.id).catch(() => {});
                setBust(null);
                onDecorChange?.();
              }}
              style={[s.open, { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.creamInk }]}
              accessibilityRole="button"
            >
              <Caps style={{ color: colors.creamInk, fontSize: 10 }}>Take it off the shelf</Caps>
            </Pressable>
          )}
        </Animated.View>
      ) : chosen ? (
        <Animated.View key={chosen.id} entering={FadeInDown.duration(400)} style={s.placard}>
          <Caps style={{ color: colors.creamSoft, fontSize: 9 }}>{chosen.author}</Caps>
          <Text style={s.title} numberOfLines={2}>
            {chosen.title}
          </Text>
          <Text style={s.meta}>{[chosen.year, chosen.edition, chosen.binding].filter(Boolean).join(' · ')}</Text>
          {!readOnly && (
            <Pressable onPress={() => onOpen(chosen.id)} style={s.open} accessibilityRole="button">
              <Caps style={{ color: colors.cream, fontSize: 10 }}>Open the showcase</Caps>
            </Pressable>
          )}
        </Animated.View>
      ) : (
        <Animated.View entering={FadeIn.delay(1200)} style={s.hint} pointerEvents="none">
          <Italic style={{ fontSize: 14, textAlign: 'center' }}>Tap a spine to take it off the shelf.</Italic>
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  placard: { position: 'absolute', left: 20, right: 20, bottom: 18, backgroundColor: colors.cream, padding: 16 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.creamInk, lineHeight: 27, marginTop: 2 },
  meta: { fontFamily: fonts.bodyItalic, fontSize: 13.5, color: colors.creamSoft, marginTop: 2 },
  open: { marginTop: 12, backgroundColor: colors.creamInk, paddingVertical: 10, alignItems: 'center' },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 18 },
});
