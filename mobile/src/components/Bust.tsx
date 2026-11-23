// A character from a book as an antique marble bust.
// Head and shoulders: a real 3D head scan (Lee Perry-Smith, CC BY 3.0), fetched
// once from our server as a compact binary and carved in generated Carrara marble.
// The character's look (hair, beard, headwear, drapery) is added on top from a few
// words chosen by the Sculptor agent. Repeated details are GPU-instanced.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas as _r3f } from '@react-three/fiber';
void _r3f; // importing it installs the phone's image loader (used for the marble texture)

import { getBase } from '@/api';

export type Look = {
  figure?: 'feminine' | 'masculine';
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

/** Carrara marble: warm white with fine grey veining (fbm). Only a fallback now: the library
 *  server renders the same recipe at 512² (/api/tex/marble.jpg), because doing it here took
 *  seconds of the phone's JS thread and held up the whole bookcase. */
function proceduralMarble(N = 128) {
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
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

let _marble: THREE.Texture | null = null;
let _marbleLoading = false;
const _waiting = new Set<THREE.MeshStandardMaterial>();

function marbleIn(t: THREE.Texture) {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _marble = t;
  _waiting.forEach((m) => {
    m.map = t;
    m.needsUpdate = true;
  });
  _waiting.clear();
}

/** Start fetching the marble (~30 KB, cached by the server). Safe to call many times. */
export function preloadMarble() {
  if (_marble || _marbleLoading) return;
  _marbleLoading = true;
  getBase()
    .then((base) => new THREE.TextureLoader().loadAsync(`${base}/api/tex/marble.jpg`))
    .then(marbleIn)
    .catch(() => marbleIn(proceduralMarble(128)));
}

/** A material carved in marble: plain warm white until the texture arrives, then veined. */
function marbled(m: THREE.MeshStandardMaterial) {
  if (_marble) m.map = _marble;
  else {
    _waiting.add(m);
    preloadMarble();
  }
  return m;
}

let _mats: { marble: THREE.MeshStandardMaterial; plinth: THREE.MeshStandardMaterial } | null = null;
export function marbleMats() {
  if (_mats) return _mats;
  _mats = {
    marble: marbled(new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0, side: THREE.DoubleSide })),
    plinth: marbled(new THREE.MeshStandardMaterial({ roughness: 0.6, color: '#A8A196' })),
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
// Every ray here starts at one point inside the head, so triangles are sorted once into
// direction bins (azimuth × elevation as seen from that point). A ray then tests only the
// few dozen triangles in its bin instead of all ~17,700 — testing them all took seconds on
// the phone's JS engine and held up the whole bookcase.
const NU = 64, NV = 32;
const _bins = new Map<string, number[][]>();

function binOf(dx: number, dy: number, dz: number): [number, number] {
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  const u = ((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI)) * NU;
  const v = ((Math.asin(Math.max(-1, Math.min(1, dy / len))) + Math.PI / 2) / Math.PI) * NV;
  return [u, v];
}

function binsFor(scan: Scan, o: [number, number, number]): number[][] {
  const key = `${o[0].toFixed(4)},${o[1].toFixed(4)},${o[2].toFixed(4)}`;
  const hit = _bins.get(key);
  if (hit && (hit as any).geom === scan.geom) return hit;
  const P = scan.geom.attributes.position.array as Float32Array;
  const I = scan.geom.index!.array as Uint16Array;
  const cells: number[][] = Array.from({ length: NU * NV }, () => []);
  const us = [0, 0, 0], vs = [0, 0, 0];
  for (let t = 0; t < I.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = I[t + k] * 3;
      const [u, v] = binOf(P[a] - o[0], P[a + 1] - o[1], P[a + 2] - o[2]);
      us[k] = u;
      vs[k] = v;
    }
    let u0 = Math.floor(Math.min(us[0], us[1], us[2])) - 1, u1 = Math.floor(Math.max(us[0], us[1], us[2])) + 1;
    const v0 = Math.max(0, Math.floor(Math.min(vs[0], vs[1], vs[2])) - 1), v1 = Math.min(NV - 1, Math.floor(Math.max(vs[0], vs[1], vs[2])) + 1);
    if (u1 - u0 > NU / 2 || v0 === 0 || v1 === NV - 1) {
      u0 = 0; // straddles the seam behind the head or sits at a pole: put it in every column
      u1 = NU - 1;
    }
    for (let v = v0; v <= v1; v++) for (let u = u0; u <= u1; u++) cells[v * NU + ((u + NU) % NU)].push(t);
  }
  (cells as any).geom = scan.geom;
  _bins.set(key, cells);
  return cells;
}

/** Distance along the ray (o + s·d) to the triangle, either side (Möller–Trumbore); -1 if it misses. */
function hitTri(P: Float32Array, I: Uint16Array, t: number, o: [number, number, number], d: [number, number, number]) {
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
  const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
  const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
  const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = o[0] - P[a], ty = o[1] - P[a + 1], tz = o[2] - P[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const s = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return s > 0 ? s : -1;
}

/** Move approximate points onto the scan's real surface (ray from `origin` through each point),
 *  lifted off the skin by `lift`. Points whose ray misses are dropped. */
function onSurface(scan: Scan, pts: [number, number, number][], origin: [number, number, number], lift: number) {
  const cells = binsFor(scan, origin);
  const P = scan.geom.attributes.position.array as Float32Array;
  const I = scan.geom.index!.array as Uint16Array;
  const out: [number, number, number][] = [];
  const d: [number, number, number] = [0, 0, 0];
  const maxR = Math.max(scan.head.rx, scan.head.ry, scan.head.rz) * 1.45; // further = not the head
  for (const p of pts) {
    const dx = p[0] - origin[0], dy = p[1] - origin[1], dz = p[2] - origin[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    d[0] = dx / len;
    d[1] = dy / len;
    d[2] = dz / len;
    const [u, v] = binOf(d[0], d[1], d[2]);
    const cell = cells[Math.min(NV - 1, Math.floor(v)) * NU + (Math.floor(u) % NU)];
    let far = -1; // outermost surface along the ray
    for (const t of cell) {
      const s = hitTri(P, I, t, origin, d);
      if (s > far) far = s;
    }
    if (far < 0 || far > maxR) continue;
    const k = far + lift;
    out.push([origin[0] + d[0] * k, origin[1] + d[1] * k, origin[2] + d[2] * k]);
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

// ---------------------------------------------------------------- one scan, many sitters
// Every bust starts from the same head scan, so each character gets its own proportions
// (head width, face length, depth) from their seed, and a feminine figure gets a narrower
// jaw, slimmer neck and narrower shoulders. Done once per character on ~9k vertices.
const _morphs = new Map<string, Scan>();
function sitter(scan: Scan, seed: number, figure: string): Scan {
  const key = `${seed}|${figure}`;
  const hit = _morphs.get(key);
  if (hit && (hit as any).base === scan.geom) return hit;
  const h = scan.head;
  const r = rand(seed * 7 + 3);
  const fem = figure === 'feminine';
  const W = 0.95 + r() * 0.09; // head width
  const L = 0.96 + r() * 0.08; // face length
  const D = 0.96 + r() * 0.07; // head depth
  const P = new Float32Array(scan.geom.attributes.position.array as Float32Array);
  const span = Math.max(0.05, h.cy - h.chin);
  carveFace(P, h, scan.faceZ, rand(seed * 13 + 5), fem);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    let nx = x, ny = y, nz = z;
    if (y > h.neck) {
      // the head: proportions around its centre, blended in over the neck
      const k = Math.min(1, (y - h.neck) / 0.08);
      nx = h.cx + (x - h.cx) * (1 + (W - 1) * k);
      nz = h.cz + (z - h.cz) * (1 + (D - 1) * k);
      ny = h.cy + (y - h.cy) * (1 + (L - 1) * k);
      if (fem && y < h.cy) {
        // a finer jaw and chin: narrow the lower face, most at the chin
        const t = Math.min(1, Math.max(0, (h.cy - y) / span));
        nx = h.cx + (nx - h.cx) * (1 - 0.13 * t * t);
        nz = h.cz + (nz - h.cz) * (1 - 0.04 * t);
      }
    } else if (fem) {
      // slimmer neck, narrower shoulders
      const t = Math.min(1, (h.neck - y) / 0.12);
      const sx = 1 - 0.12 * (1 - t) - 0.1 * t;
      nx = h.cx + (x - h.cx) * sx;
      nz = h.cz + (z - h.cz) * (1 - 0.08 * (1 - t) - 0.04 * t);
    }
    P[i] = nx;
    P[i + 1] = ny;
    P[i + 2] = nz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('uv', scan.geom.attributes.uv);
  g.setIndex(scan.geom.index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const head: Head = {
    ...h,
    rx: h.rx * W,
    rz: h.rz * D,
    ry: h.ry * L,
    top: h.cy + (h.top - h.cy) * L,
    chin: h.cy + (h.chin - h.cy) * L,
  };
  const out: Scan = { geom: g, head, faceZ: scan.faceZ };
  (out as any).base = scan.geom;
  _morphs.set(key, out);
  return out;
}

/** Each sitter's own features. Soft bumps around landmarks measured on the scan's profile
 *  (chin, lips, nose, eyes, brow, cheekbones, all as heights above the chin): the nose longer
 *  or shorter, wider or finer; the brow heavier or smoother; cheekbones higher; lips fuller;
 *  the chin stronger or softer. A feminine figure leans finer: smaller nose, smooth brow,
 *  fuller lips, softer chin. */
function carveFace(P: Float32Array, h: Head, faceZ: number, r: () => number, fem: boolean) {
  const s = () => r() * 2 - 1; // -1..1
  const c = h.chin;
  const z0 = faceZ - 0.11; // roughly the plane of the cheeks
  const nose = { y: c + 0.3, len: s() * 0.5 - (fem ? 0.28 : 0), wid: s() * 0.32 - (fem ? 0.18 : 0), droop: s() * 0.02 };
  const brow = fem ? -0.016 + s() * 0.005 : s() * 0.02 + 0.008;
  const cheek = Math.max(0, s() * 0.02 + 0.012 + (fem ? 0.008 : 0));
  const lips = s() * 0.006 + (fem ? 0.012 : 0.002);
  const chin = { fwd: s() * 0.035 - (fem ? 0.014 : 0), down: s() * 0.028 - (fem ? 0.008 : 0), wid: s() * 0.22 - (fem ? 0.12 : 0) };
  const jaw = fem ? 0 : s() * 0.09; // broader or narrower jaw (a feminine jaw is already narrowed later)
  const g = (dx: number, dy: number, dz: number, sx: number, sy: number, sz: number) =>
    Math.exp(-((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sz) ** 2));
  for (let i = 0; i < P.length; i += 3) {
    let x = P[i], y = P[i + 1], z = P[i + 2];
    if (z < h.cz || y < c - 0.1 || y > c + 0.7) continue; // only the face
    const dx = x - h.cx;
    // nose: longer/shorter (forward), wider/finer, tip up or down
    const wn = g(dx, y - nose.y, z - faceZ, 0.06, 0.09, 0.1);
    if (wn > 0.01) {
      z += Math.max(0, z - z0) * nose.len * wn;
      x += dx * nose.wid * wn;
      y -= nose.droop * wn * Math.max(0, (z - z0) / 0.11);
    }
    // brow ridge across both eyes
    const wb = g(Math.max(0, Math.abs(dx) - 0.1), y - (c + 0.53), z - (faceZ - 0.09), 0.05, 0.03, 0.06);
    z += brow * wb;
    // cheekbones, high on each side
    const wc = g(Math.abs(dx) - 0.16, y - (c + 0.37), z - (faceZ - 0.19), 0.05, 0.045, 0.07);
    x += Math.sign(dx) * cheek * wc;
    z += cheek * 0.6 * wc;
    // lips
    const wl = g(dx, y - (c + 0.195), z - (faceZ - 0.06), 0.06, 0.03, 0.05);
    z += lips * wl;
    // chin: forward/back, longer/shorter, broader/narrower
    const wch = g(dx, y - (c + 0.07), z - (faceZ - 0.08), 0.07, 0.06, 0.08);
    z += chin.fwd * wch;
    y -= chin.down * wch;
    x += dx * chin.wid * wch;
    // jaw width, strongest at the jaw angle below the ears
    const wj = g(0, y - (c + 0.12), 0, 1, 0.11, 1) * Math.min(1, Math.abs(dx) / 0.12);
    x += dx * jaw * wj;
    P[i] = x;
    P[i + 1] = y;
    P[i + 2] = z;
  }
}

/** Long hair that falls past the ears to the shoulders: vertical carved locks around the
 *  sides and back of the head, leaving the face clear. Curly hair falls as curls. */
function hairFall(h: Head, seed: number, curly: boolean): [number, number, number][] {
  const r = rand(seed + 9);
  const pts: [number, number, number][] = [];
  const cols = curly ? 30 : 40;
  const yTop = h.cy + h.ry * 0.25, yBot = h.neck - (curly ? 0.16 : 0.22);
  const rowsN = curly ? 10 : 7;
  for (let c = 0; c < cols; c++) {
    // from just behind one cheek, round the back, to the other (front ±70° stays clear)
    const a = Math.PI * 0.39 + (c / (cols - 1)) * Math.PI * 1.22;
    for (let k = 0; k < rowsN; k++) {
      const f = k / (rowsN - 1);
      const y = yTop + (yBot - yTop) * f + (r() - 0.5) * (curly ? 0.05 : 0.02); // curls tumble, not stack
      // hugs the skull at the top, then hangs a little wider as it reaches the shoulders
      const spread = 1.0 + f * 0.1 + (r() - 0.5) * 0.035 + (c % 2) * 0.025; // two staggered layers
      pts.push([h.cx + Math.sin(a) * h.rx * spread, y, h.cz - 0.03 + Math.cos(a) * h.rz * spread * 0.95]);
    }
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
  // long hair falls to the shoulders; a woman's curls or waves fall too
  const fem = L.figure === 'feminine';
  const fall = useMemo(
    () => (L.hair === 'long' || (fem && (L.hair === 'curls' || L.hair === 'waves')) ? hairFall(h, seed, L.hair === 'curls') : []),
    [L.hair, fem, seed, h],
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
      {fall.length > 0 && (
        <>
          {/* the carved mass of the hair behind the locks, so no light shows through */}
          <mesh material={m} position={[h.cx, (h.cy + h.ry * 0.2 + h.neck - 0.2) / 2, h.cz - 0.03]} scale={[h.rx * 0.98, 1, h.rz * 0.93]}>
            <cylinderGeometry args={[1, 1.08, h.cy + h.ry * 0.2 - (h.neck - 0.2), 40, 1, true, Math.PI * 0.42, Math.PI * 1.16]} />
          </mesh>
          <Instanced positions={fall} scale={L.hair === 'curls' ? 0.064 : [0.06, 0.17, 0.056]} geom={SPHERE} material={m} />
        </>
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
      {L.drape === 'chiton' &&
        [-1, 1].map((s) => (
          <mesh key={s} material={m} position={[s * 0.42, h.neck - 0.08, 0.1]} scale={0.05}>
            <sphereGeometry args={[1, 14, 10]} />
          </mesh>
        ))}
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
    _garmentMats[key] = marbled(new THREE.MeshStandardMaterial({
      roughness: drape === 'armor' ? 0.22 : 0.42,
      color: drape === 'armor' ? '#E4DED4' : '#F4F0E8',
      side: THREE.DoubleSide,
      clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, -1, 0), neckline)],
    }));
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
  const base = useScan();
  const L = { figure: 'masculine', hair: 'waves', beard: 'none', headwear: 'none', drape: 'toga', age: 'middle', build: 'average', ...look } as Required<Look>;
  if (L.figure === 'feminine') {
    L.beard = 'none';
    if (L.hair === 'cropped' || L.hair === 'bald') L.hair = 'long';
  }
  // each character is carved from the scan with their own proportions
  const scan = useMemo(() => (base ? sitter(base, seed, L.figure) : null), [base, seed, L.figure]);
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
