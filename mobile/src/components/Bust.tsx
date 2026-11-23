// A character from a book as an antique marble bust.
// Head and shoulders: a real 3D head scan (Lee Perry-Smith, CC BY 3.0), fetched
// once from our server as a compact binary and carved in generated Carrara marble.
// The character's look (hair, beard, headwear, drapery) is added on top from a few
// words chosen by the Sculptor agent. Repeated details are GPU-instanced.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { getBase } from '@/api';

export type Look = {
  hair?: 'curls' | 'waves' | 'long' | 'cropped' | 'bald' | 'bun' | 'veil';
  beard?: 'none' | 'short' | 'full';
  headwear?: 'none' | 'laurel' | 'diadem' | 'helmet' | 'hood' | 'crown';
  drape?: 'toga' | 'chiton' | 'armor' | 'cloak' | 'robe';
  age?: 'young' | 'middle' | 'old';
  build?: 'slight' | 'average' | 'broad';
};

export const BUST_CREDIT = 'Head scan: Lee Perry-Smith (ir-ltd.net), CC BY 3.0';

// ---------------------------------------------------------------- marble
function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

let _marble: THREE.Texture | null = null;
/** Carrara marble: warm white with fine grey veining (generated once, 512², fbm). */
export function marbleTexture() {
  if (_marble) return _marble;
  const N = 512;
  const r = rand(11);
  const G = 16;
  const lat = Array.from({ length: (G + 1) * (G + 1) }, () => r());
  const vn = (x: number, y: number) => {
    x = ((x % 1) + 1) % 1;
    y = ((y % 1) + 1) % 1;
    const gx = x * G, gy = y * G;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const at = (i: number, j: number) => lat[(j % G) * (G + 1) + (i % G)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const fbm = (x: number, y: number) => vn(x, y) * 0.5 + vn(x * 2, y * 2) * 0.25 + vn(x * 4, y * 4) * 0.125 + vn(x * 8, y * 8) * 0.0625;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const t = fbm(u, v);
      const vein = Math.abs(Math.sin((u * 2 + v * 1 + t * 3.2) * Math.PI * 2));
      const thin = Math.pow(1 - vein, 60) * 0.42 + Math.pow(1 - vein, 9) * 0.06;
      const cloud = (fbm(u * 2 + 0.3, v * 2) - 0.47) * 0.09;
      const dark = Math.max(0, thin + cloud);
      const i = (y * N + x) * 4;
      data[i] = Math.round(246 - dark * 120);
      data[i + 1] = Math.round(243 - dark * 118);
      data[i + 2] = Math.round(236 - dark * 108);
      data[i + 3] = 255;
    }
  _marble = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  _marble.wrapS = _marble.wrapT = THREE.RepeatWrapping;
  _marble.colorSpace = THREE.SRGBColorSpace;
  _marble.generateMipmaps = true;
  _marble.minFilter = THREE.LinearMipmapLinearFilter;
  _marble.needsUpdate = true;
  return _marble;
}

let _mats: { marble: THREE.MeshStandardMaterial; plinth: THREE.MeshStandardMaterial } | null = null;
export function marbleMats() {
  if (_mats) return _mats;
  _mats = {
    marble: new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.32, metalness: 0, side: THREE.DoubleSide }),
    plinth: new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.6, color: '#A8A196' }),
  };
  return _mats;
}

// ---------------------------------------------------------------- the scan
type Head = { cx: number; cy: number; cz: number; rx: number; ry: number; rz: number; top: number; neck: number; chin: number };
type Scan = { geom: THREE.BufferGeometry; head: Head; faceZ: number };
let _scan: Promise<Scan | null> | null = null;
let _scanReady: Scan | null = null;

function loadScan(): Promise<Scan | null> {
  if (_scan) return _scan;
  _scan = (async () => {
    try {
      const res = await fetch(`${await getBase()}/api/models/bust.bin`);
      if (!res.ok) throw new Error(String(res.status));
      const buf = await res.arrayBuffer();
      const dv = new DataView(buf);
      const nV = dv.getUint32(4, true), nI = dv.getUint32(8, true), nJ = dv.getUint32(12, true);
      const meta = JSON.parse(String.fromCharCode(...new Uint8Array(buf, 16, nJ)).trim());
      let off = 16 + nJ;
      const pos = new Float32Array(buf.slice(off, off + nV * 12));
      off += nV * 12;
      const n8 = new Int8Array(buf.slice(off, off + nV * 4));
      off += nV * 4;
      const idx = new Uint16Array(buf.slice(off, off + nI * 2));
      const nrm = new Float32Array(nV * 3);
      for (let i = 0; i < nV; i++) {
        nrm[i * 3] = n8[i * 4] / 127;
        nrm[i * 3 + 1] = n8[i * 4 + 1] / 127;
        nrm[i * 3 + 2] = n8[i * 4 + 2] / 127;
      }
      // marble veins via a simple cylindrical UV wrap (the scan's own UVs aren't needed)
      const uv = new Float32Array(nV * 2);
      for (let i = 0; i < nV; i++) {
        uv[i * 2] = (Math.atan2(pos[i * 3], pos[i * 3 + 2]) / (Math.PI * 2) + 0.5) * 1.6;
        uv[i * 2 + 1] = pos[i * 3 + 1] * 0.55;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      _scanReady = { geom: g, head: meta.head, faceZ: meta.faceZ };
      return _scanReady;
    } catch {
      _scan = null; // retry next time
      return null;
    }
  })();
  return _scan;
}

function useScan() {
  const [scan, setScan] = useState<Scan | null>(_scanReady);
  useEffect(() => {
    if (_scanReady) return;
    let alive = true;
    loadScan().then((s) => alive && setScan(s));
    return () => {
      alive = false;
    };
  }, []);
  return scan;
}

// ---------------------------------------------------------------- surface fitting
let _probe: THREE.Mesh | null = null;
const _ray = new THREE.Raycaster();
/** Move approximate points onto the scan's real surface (ray from `origin` through each point),
 *  lifted off the skin by `lift`. Points whose ray misses are dropped. */
function onSurface(scan: Scan, pts: [number, number, number][], origin: [number, number, number], lift: number) {
  if (!_probe || _probe.geometry !== scan.geom) _probe = new THREE.Mesh(scan.geom, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const o = new THREE.Vector3(...origin);
  const out: [number, number, number][] = [];
  const d = new THREE.Vector3();
  for (const p of pts) {
    d.set(p[0], p[1], p[2]).sub(o).normalize();
    _ray.set(o, d);
    const hit = _ray.intersectObject(_probe, false);
    const far = hit.length ? hit[hit.length - 1] : null; // outermost surface along the ray
    if (!far) continue;
    const q = far.point.clone().addScaledVector(d, lift);
    out.push([q.x, q.y, q.z]);
  }
  return out;
}

// ---------------------------------------------------------------- pieces
const SPHERE = new THREE.SphereGeometry(1, 12, 9);
const LEAF = new THREE.SphereGeometry(1, 8, 6);
const CONE = new THREE.ConeGeometry(1, 1, 8);

function Instanced({ positions, scale, geom, material, face = true, normalFrom }: { positions: [number, number, number][]; scale: number | [number, number, number]; geom: THREE.BufferGeometry; material: THREE.Material; face?: boolean; normalFrom?: [number, number, number, number, number, number] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = Array.isArray(scale) ? new THREE.Vector3(...scale) : new THREE.Vector3(scale, scale, scale);
    const up = new THREE.Vector3(0, 1, 0);
    const nrm = new THREE.Vector3();
    const twist = new THREE.Quaternion();
    positions.forEach((p, i) => {
      if (normalFrom) {
        const [cx, cy, cz, rx, ry, rz] = normalFrom;
        nrm.set((p[0] - cx) / (rx * rx), (p[1] - cy) / (ry * ry), (p[2] - cz) / (rz * rz)).normalize();
        q.setFromUnitVectors(up, nrm);
        // locks sweep back over the crown, like combed and carved hair
        twist.setFromAxisAngle(nrm, Math.atan2(p[0] - cx, p[2] - cz) + (i % 3) * 0.25);
        q.premultiply(twist);
      } else q.setFromEuler(new THREE.Euler(0, face ? Math.atan2(p[0], p[2]) : 0, 0));
      const j = 0.78 + ((i * 2654435761) % 1000) / 1000 * 0.44;
      m.compose(new THREE.Vector3(...p), q, s.clone().multiplyScalar(j));
      ref.current?.setMatrixAt(i, m);
    });
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true;
  }, [positions, scale, normalFrom]);
  if (!positions.length) return null;
  return <instancedMesh ref={ref} args={[geom, material, positions.length]} />;
}

/** Points on the upper skull ellipsoid, leaving the face clear. */
function skullPoints(h: Head, n: number, seed: number, grow = 1.0): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const rnd = rand(seed);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const sx = h.rx * 0.93 * grow, sy = h.ry * 1.0 * grow, sz = h.rz * 0.9 * grow;
  const M = n * 4;
  for (let i = 0; i < M && pts.length < n; i++) {
    const y = 1 - (i / (M - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = golden * i;
    const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
    if (y < 0.05) continue; // only above the ears
    if (z > 0.3 && y < 0.55) continue; // the forehead and face stay bare
    const j = 1 + (rnd() - 0.5) * 0.06;
    pts.push([h.cx + x * sx * j, h.cy + y * sy * j + 0.02, h.cz - 0.03 + z * sz * j]);
  }
  return pts;
}

function Plinth() {
  const m = marbleMats();
  return (
    <group>
      <mesh material={m.plinth} position={[0, -0.27, 0]}>
        <boxGeometry args={[0.95, 0.2, 0.8]} />
      </mesh>
      <mesh material={m.plinth} position={[0, -0.12, 0]}>
        <cylinderGeometry args={[0.3, 0.4, 0.12, 32]} />
      </mesh>
      <mesh material={m.plinth} position={[0, -0.03, 0]}>
        <cylinderGeometry args={[0.36, 0.3, 0.06, 32]} />
      </mesh>
    </group>
  );
}

function Accessories({ scan, h, L, seed }: { scan: Scan; h: Head; L: Required<Look>; seed: number }) {
  const m = marbleMats().marble;
  const sx = h.rx * 0.93, sy = h.ry * 1.0, sz = h.rz * 0.9;
  const headO: [number, number, number] = [h.cx, h.cy - 0.05, h.cz - 0.05];
  const curls = useMemo(() => (L.hair === 'curls' ? onSurface(scan, skullPoints(h, 90, seed, 1.0), headO, 0.035) : []), [L.hair, seed, scan]);
  const locks = useMemo(
    () => (['waves', 'long', 'bun', 'cropped'].includes(L.hair) ? onSurface(scan, skullPoints(h, L.hair === 'cropped' ? 120 : 100, seed + 1, 1.0), headO, L.hair === 'cropped' ? 0.014 : 0.024) : []),
    [L.hair, seed, scan],
  );
  const beardCurls = useMemo(() => {
    if (L.beard === 'none') return [];
    // curls along the jaw, from ear to ear through the chin
    const pts: [number, number, number][] = [];
    const r = rand(seed + 5);
    const rows = L.beard === 'full' ? 4 : 3;
    const per = L.beard === 'full' ? 19 : 17;
    for (let row = 0; row < rows; row++)
      for (let i = 0; i < per; i++) {
        const a = -1.3 + (i / (per - 1)) * 2.6;
        const inset = 1 - row * 0.07;
        pts.push([
          h.cx + Math.sin(a) * h.rx * 0.74 * inset,
          h.chin + 0.075 + row * 0.042 + (1 - Math.cos(a)) * 0.2 + (r() - 0.5) * 0.015,
          h.cz + 0.02 + Math.cos(a) * h.rz * 0.72 * inset,
        ]);
      }
    // snap onto the jaw: rays from inside the mouth/jaw outward
    return onSurface(scan, pts, [h.cx, h.chin + 0.22, h.cz - 0.08], L.beard === 'full' ? 0.022 : 0.012);
  }, [L.beard, seed, scan]);
  const laurel = useMemo(() => {
    if (L.headwear !== 'laurel') return [];
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      if (Math.cos(a) < -0.85) continue; // tied at the back
      pts.push([h.cx + Math.sin(a) * sx * 1.04, h.cy + sy * 0.38 + Math.cos(a) * 0.04, h.cz - 0.03 + Math.cos(a) * sz * 1.04]);
    }
    return onSurface(scan, pts, headO, 0.03);
  }, [L.headwear, scan]);
  const crown = useMemo(
    () =>
      L.headwear === 'crown'
        ? Array.from({ length: 10 }, (_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return [h.cx + Math.sin(a) * sx * 1.0, h.cy + sy * 0.78, h.cz - 0.03 + Math.cos(a) * sz * 1.0] as [number, number, number];
          })
        : [],
    [L.headwear, h],
  );
  const capY = h.cy + 0.02;
  return (
    <group>
      {/* hair: carved locks lying on the scalp (a slim cap underneath fills the gaps) */}
      {false && (
        <mesh material={m} position={[h.cx, capY, h.cz - 0.04]} rotation={[-0.42, 0, 0]} scale={[sx * 1.0, sy * 0.99, sz * 0.99]}>
          <sphereGeometry args={[1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
        </mesh>
      )}
      {L.hair === 'curls' && <Instanced positions={curls} scale={0.07} geom={SPHERE} material={m} />}
      {(L.hair === 'waves' || L.hair === 'long' || L.hair === 'bun' || L.hair === 'cropped') && (
        <Instanced
          positions={locks}
          scale={L.hair === 'cropped' ? [0.045, 0.034, 0.065] : [0.055, 0.042, 0.11]}
          geom={SPHERE}
          material={m}
          normalFrom={[h.cx, h.cy + 0.02, h.cz - 0.03, sx, sy, sz]}
        />
      )}
      {L.hair === 'long' && (
        <mesh material={m} position={[h.cx, h.cy - 0.32, h.cz - 0.12]} scale={[sx * 1.1, 1, sz * 0.9]}>
          <cylinderGeometry args={[0.9, 1.05, 0.62, 28, 1, true, Math.PI * 0.55, Math.PI * 0.9]} />
        </mesh>
      )}
      {L.hair === 'bun' && (
        <mesh material={m} position={[h.cx, h.cy + 0.06, h.cz - sz * 1.05]} scale={0.13}>
          <sphereGeometry args={[1, 18, 14]} />
        </mesh>
      )}
      {L.hair === 'veil' && (
        <mesh material={m} position={[h.cx, h.cy - 0.1, h.cz - 0.06]} scale={[sx * 1.2, sy * 1.35, sz * 1.15]}>
          <sphereGeometry args={[1, 40, 24, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.8]} />
        </mesh>
      )}

      {/* beard */}
      {L.beard !== 'none' && <Instanced positions={beardCurls} scale={L.beard === 'full' ? 0.036 : 0.026} geom={SPHERE} material={m} />}

      {/* headwear */}
      {L.headwear === 'laurel' && <Instanced positions={laurel} scale={[0.03, 0.014, 0.075]} geom={LEAF} material={m} />}
      {L.headwear === 'diadem' && (
        <mesh material={m} position={[h.cx, h.cy + sy * 0.42, h.cz - 0.03]} rotation={[Math.PI / 2 - 0.22, 0, 0]} scale={[sx * 0.86, sz * 0.84, 1]}>
          <torusGeometry args={[1, 0.022, 8, 48]} />
        </mesh>
      )}
      {L.headwear === 'crown' && (
        <>
          <mesh material={m} position={[h.cx, h.cy + sy * 0.62, h.cz - 0.03]} scale={[sx * 1.02, 1, sz * 1.02]}>
            <cylinderGeometry args={[1, 0.98, 0.13, 40, 1, true]} />
          </mesh>
          <Instanced positions={crown} scale={[0.035, 0.12, 0.035]} geom={CONE} material={m} face={false} />
        </>
      )}
      {L.headwear === 'helmet' && (
        <>
          <mesh material={m} position={[h.cx, capY, h.cz - 0.04]} rotation={[-0.25, 0, 0]} scale={[sx * 1.16, sy * 1.14, sz * 1.14]}>
            <sphereGeometry args={[1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
          </mesh>
          <mesh material={m} position={[h.cx, h.top + 0.12, h.cz - 0.05]} scale={[0.045, 0.17, sz * 1.1]}>
            <sphereGeometry args={[1, 18, 12]} />
          </mesh>
        </>
      )}
      {L.headwear === 'hood' && (
        <mesh material={m} position={[h.cx, h.cy - 0.04, h.cz - 0.08]} scale={[sx * 1.3, sy * 1.42, sz * 1.24]}>
          <sphereGeometry args={[1, 40, 24, Math.PI * 0.7, Math.PI * 1.6, 0, Math.PI * 0.74]} />
        </mesh>
      )}

      {/* drapery: details on top of the garment layer (see Garment) */}
      {L.drape === 'toga' &&
        [0, 1, 2].map((k) => (
          <mesh key={k} material={m} position={[0.1 - k * 0.05, 0.42 - k * 0.1, 0.12]} rotation={[0.25, 0.1, -0.7]} scale={[1, 1, 0.48]}>
            <torusGeometry args={[0.55 + k * 0.06, 0.035, 10, 36, Math.PI * 0.62]} />
          </mesh>
        ))}
      {L.drape === 'chiton' &&
        [-1, 1].map((s) => (
          <mesh key={s} material={m} position={[s * 0.42, h.neck - 0.08, 0.1]} scale={0.05}>
            <sphereGeometry args={[1, 14, 10]} />
          </mesh>
        ))}
      {L.drape === 'cloak' && (
        <mesh material={m} position={[0.36, h.neck - 0.12, 0.18]} scale={0.065}>
          <sphereGeometry args={[1, 14, 10]} />
        </mesh>
      )}
    </group>
  );
}

/** Cloth over the shoulders: the scan itself, a touch larger, clipped below the neckline,
 *  so the drapery follows the body like carved fabric. */
const _garmentMats: Record<string, THREE.MeshStandardMaterial> = {};
function Garment({ scan, drape }: { scan: Scan; drape: string }) {
  const neckline = scan.head.neck - (drape === 'armor' ? 0.02 : drape === 'chiton' ? 0.1 : 0.04);
  const key = `${drape}|${neckline.toFixed(3)}`;
  if (!_garmentMats[key]) {
    _garmentMats[key] = new THREE.MeshStandardMaterial({
      map: marbleTexture(),
      roughness: drape === 'armor' ? 0.22 : 0.42,
      color: drape === 'armor' ? '#E4DED4' : '#F4F0E8',
      side: THREE.DoubleSide,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), neckline)],
    });
  }
  const grow = drape === 'cloak' ? 1.06 : drape === 'armor' ? 1.03 : 1.04;
  return (
    <group>
      <mesh geometry={scan.geom} material={_garmentMats[key]} scale={[grow, 1.0, grow]} position={[0, -0.004, 0]} />
    </group>
  );
}

/** The scan isn't loaded (yet): a simple procedural stand-in so there's never a hole. */
function StandIn() {
  const m = marbleMats().marble;
  return (
    <group>
      <mesh material={m} position={[0, 0.3, 0]} scale={[1, 0.6, 0.6]}>
        <sphereGeometry args={[0.6, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh material={m} position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.14, 0.17, 0.4, 20]} />
      </mesh>
      <mesh material={m} position={[0, 1.35, 0]} scale={[0.85, 1.05, 0.95]}>
        <sphereGeometry args={[0.4, 28, 20]} />
      </mesh>
    </group>
  );
}

export default function Bust({ look = {}, seed = 1 }: { look?: Look; seed?: number }) {
  const scan = useScan();
  const L = { hair: 'waves', beard: 'none', headwear: 'none', drape: 'toga', age: 'middle', build: 'average', ...look } as Required<Look>;
  const W = L.build === 'broad' ? 1.06 : L.build === 'slight' ? 0.94 : 1;
  return (
    <group>
      <Plinth />
      <group scale={[W, 1, W]}>
        {scan ? (
          <>
            <mesh geometry={scan.geom} material={marbleMats().marble} />
            <Garment scan={scan} drape={L.drape} />
            <Accessories scan={scan} h={scan.head} L={L} seed={seed} />
          </>
        ) : (
          <StandIn />
        )}
      </group>
    </group>
  );
}

/** Start the download early (e.g. when the Library opens) so busts appear instantly. */
export function preloadBust() {
  loadScan();
}
