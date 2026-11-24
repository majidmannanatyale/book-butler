// The collection as a real bookcase, in 3D (three.js via React Three Fiber).
// Each book is a model sized from its height (cm) and page count, wearing its
// spine artwork (drawn by the server) on the front and its cover on the side.
// Tap a book: it slides off the shelf toward you and turns to show its cover.
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { useIsFocused } from 'expo-router';
import { allReady, loadAll, pagesUrl, shadowTexture, texUrl, useTexture } from '@/components/tex';
import * as THREE from 'three';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { api, Book, Decor } from '@/api';
import Bust from '@/components/Bust';
import { Caps, Italic, tap } from '@/components/ui';
import { colors, fonts } from '@/theme';

const SHELF_W = 2.3; // inner width of one shelf for a small library (scene units ≈ 10 cm)
/** Bigger libraries get a wider case, so 250 books fill the screen instead of one tall tower. */
const shelfWidth = (n: number) => Math.max(SHELF_W, Math.sqrt(n * 0.15));
const SHELF_GAP = 1.4; // vertical distance between shelves
const DEPTH = 0.62;

/** Books per bookcase. Bigger libraries get several cases you swipe between, so every
 * spine stays readable and the phone only draws (and downloads) one case at a time. */
export const PER_CASE = 150;

const GROUPS = ['Favourites', 'Reading now', 'Collections', 'The rest'];
function group(b: Book) {
  return b.favourite ? 0 : b.reading ? 1 : b.collection ? 2 : 3;
}

/** Favourites first, then books being read, then collections (each series together, in
 * reading order), then everything else. Inside each group the reader's own arrangement holds. */
export function shelfOrder(books: Book[]): Book[] {
  const firstSeen = new Map<string, number>();
  books.forEach((b, i) => b.collection && !firstSeen.has(b.collection) && firstSeen.set(b.collection, i));
  return books
    .map((b, i) => ({ b, i }))
    .sort((x, y) => {
      const gx = group(x.b), gy = group(y.b);
      if (gx !== gy) return gx - gy;
      if (gx === 2) {
        const cx = firstSeen.get(x.b.collection!)!, cy = firstSeen.get(y.b.collection!)!;
        if (cx !== cy) return cx - cy;
        const sx = x.b.series_index ?? 999, sy = y.b.series_index ?? 999;
        if (sx !== sy) return sx - sy;
      }
      return x.i - y.i;
    })
    .map((e) => e.b);
}

type Placed = { book: Book; x: number; y: number; z: number; w: number; h: number; lean: number; i: number };

function layout(books: Book[], SW: number): { placed: Placed[]; rows: number } {
  const placed: Placed[] = [];
  let row = 0;
  let x = -SW / 2;
  books.forEach((b, i) => {
    const h = Math.min(1.25, Math.max(0.8, (b.height_cm || 20) / 20));
    const w = 0.11 + Math.min(1000, b.pages || 320) / 1000 * 0.2;
    if (x + w > SW / 2) {
      row += 1;
      x = -SW / 2;
    }
    // books never line up perfectly: a few mm forward or back
    const z = (((b.id * 2654435761) >>> 0) % 1000) / 1000 * 0.07 - 0.035;
    placed.push({ book: b, x: x + w / 2, y: -row * SHELF_GAP + h / 2, z, w, h, lean: 0, i });
    x += w + 0.012;
  });
  // the last book on each row leans gently against its neighbour
  const rows = row + 1;
  for (let r = 0; r < rows; r++) {
    const inRow = placed.filter((p) => Math.round((p.y - p.h / 2) / -SHELF_GAP) === r);
    const last = inRow[inRow.length - 1];
    if (last && inRow.length > 3 && last.x + last.w / 2 < SW / 2 - 0.25) {
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
    // books slide back onto their own shelf one by one, straight from the front, so they never pass
    // through a shelf board or the books already standing (a drop from above went through both)
    const slide = age < 0 ? 1 : Math.max(0, 1 - age / 0.6);
    const k = 1 - Math.pow(0.001, dt); // smooth follow
    const tx = selected ? 0 : p.x;
    const ty = selected ? centerY : p.y;
    const tz = selected ? 1.6 : (anySelected ? -0.05 : 0) + p.z + slide * slide * 2.5;
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
    <group ref={ref} position={[p.x, p.y, p.z + 2.5]} rotation={[0, 0, p.lean]}>
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

let _wood: THREE.Texture | null = null;
/** Walnut: warm brown with long grain lines and a little figure (generated once). */
function woodTexture() {
  if (_wood) return _wood;
  const W = 64, H = 512;
  const data = new Uint8Array(W * H * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const offs = Array.from({ length: 12 }, () => rnd());
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      let g = 0;
      for (let k = 0; k < 12; k++) g += Math.sin((u * (6 + k * 3) + Math.sin(v * 6 + offs[k] * 6) * 0.15 + offs[k]) * Math.PI * 2) / (k + 2);
      const line = Math.pow(Math.abs(Math.sin((u * 22 + Math.sin(v * 9) * 0.35 + g * 0.08) * Math.PI)), 6);
      const t = 0.5 + g * 0.18 - line * 0.22 + (rnd() - 0.5) * 0.05;
      const i = (y * W + x) * 4;
      data[i] = Math.max(0, Math.min(255, 70 + t * 52));
      data[i + 1] = Math.max(0, Math.min(255, 42 + t * 30));
      data[i + 2] = Math.max(0, Math.min(255, 24 + t * 16));
      data[i + 3] = 255;
    }
  _wood = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  _wood.wrapS = _wood.wrapT = THREE.RepeatWrapping;
  _wood.colorSpace = THREE.SRGBColorSpace;
  _wood.needsUpdate = true;
  return _wood;
}

let _panel: THREE.Texture | null = null;
/** The back panel: deep navy, warmer and lighter near the lamp at the top. */
function panelTexture() {
  if (_panel) return _panel;
  const H = 128;
  const data = new Uint8Array(4 * H);
  for (let y = 0; y < H; y++) {
    const t = Math.pow(y / (H - 1), 1.6); // 0 bottom -> 1 top (texture v goes up)
    const i = y * 4;
    data[i] = Math.round(10 + t * 40);
    data[i + 1] = Math.round(22 + t * 30);
    data[i + 2] = Math.round(40 + t * 18);
    data[i + 3] = 255;
  }
  _panel = new THREE.DataTexture(data, 1, H, THREE.RGBAFormat);
  _panel.colorSpace = THREE.SRGBColorSpace;
  _panel.needsUpdate = true;
  return _panel;
}

function Bookcase({ rows, SW }: { rows: number; SW: number }) {
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 }), []);
  const W = SW + 0.16;
  const H = rows * SHELF_GAP + 0.2;
  const topY = SHELF_GAP - 0.05;
  const midY = topY - H / 2;
  return (
    <group>
      {/* back panel */}
      <mesh position={[0, midY, -DEPTH / 2 - 0.04]}>
        <boxGeometry args={[W, H, 0.04]} />
        <meshStandardMaterial map={panelTexture()} roughness={1} />
      </mesh>
      {/* sides */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * W) / 2, midY, 0]} material={wood}>
          <boxGeometry args={[0.08, H + 0.1, DEPTH + 0.1]} />
        </mesh>
      ))}
      {/* shelves (one under each row, plus a top) */}
      {Array.from({ length: rows }, (_, r) => (
        <mesh key={r} position={[0, -r * SHELF_GAP - 0.03, 0]} material={wood}>
          <boxGeometry args={[W, 0.06, DEPTH + 0.1]} />
        </mesh>
      ))}
      <mesh position={[0, topY, 0]} material={wood}>
        <boxGeometry args={[W + 0.1, 0.08, DEPTH + 0.14]} />
      </mesh>
      {/* brass picture light over the top shelf, casting warm light down the case */}
      <mesh position={[0, topY + 0.07, DEPTH / 2 + 0.06]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.035, 0.035, W * 0.62, 20]} />
        <meshStandardMaterial color="#B8893A" metalness={0.9} roughness={0.3} emissive="#5A3A0A" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, topY + 0.045, DEPTH / 2 + 0.075]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, W * 0.6, 8]} />
        <meshBasicMaterial color="#FFE2A8" />
      </mesh>
      <spotLight position={[0, topY - 0.05, DEPTH / 2 + 0.9]} angle={0.75} penumbra={0.9} intensity={22} distance={H + 3} decay={1.6} color="#FFD9A0" />
      {/* soft shadow where the case meets the floor */}
      <mesh position={[0, topY - H - 0.02, 0.1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W * 1.8, DEPTH * 3]} />
        <meshBasicMaterial map={shadowTexture()} transparent opacity={0.9} depthWrite={false} />
      </mesh>
    </group>
  );
}

function DecorRow({ decor, onPick, SW }: { decor: Decor[]; onPick: (d: Decor) => void; SW: number }) {
  const topY = SHELF_GAP - 0.05 + 0.04;
  const n = decor.length;
  const S = 0.36;
  return (
    <group>
      {decor.map((d, i) => {
        const x = n === 1 ? 0 : -SW / 2 + 0.25 + (i * (SW - 0.5)) / (n - 1);
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

function Rig({ rows, selected, extraTop = 0, SW }: { rows: number; selected: boolean; extraTop?: number; SW: number }) {
  const { camera, size, scene } = useThree();
  useFrame((state) => {
    // big libraries pull the camera far back; keep the fog just behind the case, never in front of it
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = camera.position.z;
      scene.fog.far = camera.position.z + 9;
    }
    const aspect = size.width / size.height;
    const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
    const totalH = rows * SHELF_GAP + 0.6 + extraTop;
    const zH = totalH / (2 * Math.tan(fov / 2));
    const zW = (SW + 0.6) / (2 * Math.tan(fov / 2) * aspect);
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
  // the busts are decoration: let the books land first, then set them on top of the case
  const [decorOn, setDecorOn] = useState(false);
  const ordered = useMemo(() => shelfOrder(books), [books]);
  const cases = Math.max(1, Math.ceil(ordered.length / PER_CASE));
  const [page, setPage] = useState(0);
  const pg = Math.min(page, cases - 1);
  const shown = useMemo(() => ordered.slice(pg * PER_CASE, (pg + 1) * PER_CASE), [ordered, pg]);
  const SW = shelfWidth(shown.length);
  const { placed, rows } = useMemo(() => layout(shown, SW), [shown, SW]);
  const chosen = books.find((b) => b.id === sel);
  const label = Array.from(new Set(shown.map(group))).map((g) => GROUPS[g]).join(' · ');
  const go = (d: number) => {
    const next = Math.max(0, Math.min(cases - 1, pg + d));
    if (next === pg) return;
    tap();
    setSel(null);
    setBust(null);
    setPage(next);
  };
  const touch = useRef<{ x: number; y: number } | null>(null);
  const focused = useIsFocused();
  // a new set of books (another tab, another case) gets a fresh shelf: the old one is cleared at once and a
  // loading sign shows until the new spines have arrived, instead of the old shelf lingering underneath
  const setKey = useMemo(() => `${shown.length}:${shown.map((b) => b.id).join(',')}`, [shown]);
  // the set whose spines are all in memory; until the new set catches up, the loading sign shows
  const [readyKey, setReadyKey] = useState(() => (allReady(base, shown, 'spine') ? setKey : ''));
  useEffect(() => {
    if (allReady(base, shown, 'spine')) {
      setReadyKey(setKey);
      return;
    }
    let alive = true;
    loadAll(base, shown, 'spine').then(() => alive && setReadyKey(setKey));
    return () => {
      alive = false;
    };
  }, [base, shown, setKey]);
  const loading = readyKey !== setKey && !allReady(base, shown, 'spine');
  return (
    <View
      style={{ flex: 1 }}
      // a sideways swipe moves to the next or previous bookcase (taps barely move, so they still pick books)
      onTouchStart={(e) => {
        touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      }}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t || cases < 2) return;
        const dx = e.nativeEvent.pageX - t.x, dy = e.nativeEvent.pageY - t.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      {cases > 1 && (
        <View style={s.cases}>
          <Pressable onPress={() => go(-1)} disabled={pg === 0} hitSlop={12} accessibilityRole="button" accessibilityLabel="Previous bookcase">
            <Text style={[s.arrow, pg === 0 && { opacity: 0.25 }]}>‹</Text>
          </Pressable>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Caps style={{ color: colors.gold, fontSize: 10 }}>{`Case ${pg + 1} of ${cases}`}</Caps>
            <Italic style={{ fontSize: 13 }} numberOfLines={1}>
              {label}
            </Italic>
          </View>
          <Pressable onPress={() => go(1)} disabled={pg === cases - 1} hitSlop={12} accessibilityRole="button" accessibilityLabel="Next bookcase">
            <Text style={[s.arrow, pg === cases - 1 && { opacity: 0.25 }]}>›</Text>
          </Pressable>
        </View>
      )}
      <View style={{ flex: 1 }}>
      <Canvas
        camera={{ fov: 38, position: [0, -1.5, 9] }}
        // paused while another tab or screen is showing: the 3D scene stays loaded (instant to come back to)
        // but stops drawing 150 books every frame in the background
        frameloop={focused ? 'always' : 'never'}
        onPointerMissed={() => {
          setSel(null);
          setBust(null);
        }}
        onCreated={({ gl }) => {
          gl.localClippingEnabled = true;
          setTimeout(() => setDecorOn(true), 450);
        }}
        style={{ flex: 1, backgroundColor: colors.paper }}
      >
        <color attach="background" args={[colors.paper]} />
        <fog attach="fog" args={[colors.paper, 9, 18]} />
        <ambientLight intensity={0.55} color="#A9CDBE" />
        <directionalLight position={[2, 4, 6]} intensity={1.1} color="#FFE6B0" />
        <pointLight position={[0, 1.2, 2.5]} intensity={6} distance={9} color="#F2B53A" />
        <pointLight position={[0, -3.5, 2.5]} intensity={4} distance={8} color="#F7C863" />
        <Suspense key={setKey} fallback={null}>
          <Bookcase rows={rows} SW={SW} />
          {!loading && placed.map((p) => (
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
        {decorOn && decor.length > 0 && (
          <Suspense fallback={null}>
            <DecorRow
              SW={SW}
              decor={decor}
              onPick={(d) => {
                tap();
                setSel(null);
                setBust(d);
              }}
            />
          </Suspense>
        )}
        <Rig rows={rows} SW={SW} selected={sel != null} extraTop={decor.length ? 0.9 : 0} />
      </Canvas>
      {loading && (
        <View style={s.loading} pointerEvents="none">
          <ActivityIndicator color={colors.gold} />
          <Italic style={{ fontSize: 15, marginTop: 10 }}>Fetching the volumes…</Italic>
        </View>
      )}
      </View>
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
  loading: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(8,19,37,0.72)' },
  placard: { position: 'absolute', left: 20, right: 20, bottom: 18, backgroundColor: colors.cream, padding: 16 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.creamInk, lineHeight: 27, marginTop: 2 },
  meta: { fontFamily: fonts.bodyItalic, fontSize: 13.5, color: colors.creamSoft, marginTop: 2 },
  open: { marginTop: 12, backgroundColor: colors.creamInk, paddingVertical: 10, alignItems: 'center' },
  hint: { position: 'absolute', left: 0, right: 0, bottom: 18 },
  cases: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 6 },
  arrow: { fontFamily: fonts.display, fontSize: 34, color: colors.gold, paddingHorizontal: 10 },
});
