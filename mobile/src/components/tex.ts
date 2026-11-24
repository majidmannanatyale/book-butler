// One texture cache for every 3D book in the app (bookcase, showcase, AR).
// The server pre-sizes each face (reader's photo > real cover > a printed cover),
// so a texture is ~20 KB and loads once; afterwards it is shared, never re-fetched.
import { useEffect, useState } from 'react';
import * as THREE from 'three';
// On the phone, react-three-fiber installs the loaders three.js needs (images via expo-asset)
// when it is first imported. Import it here so textures can be fetched before any 3D view
// has mounted (e.g. preloading from Home), not only from inside a Canvas.
import { Canvas as _r3f } from '@react-three/fiber';
void _r3f; // keep the import (and its loader setup) even if unused names get shaken out

import { Book } from '@/api';

export type Side = 'front' | 'back' | 'spine';

const cache = new Map<string, Promise<THREE.Texture | null>>();
const ready = new Map<string, THREE.Texture>();
const version = new Map<number, number>();

/** Call after new photos are saved so every 3D view picks them up. */
export function bumpTex(bookId: number) {
  version.set(bookId, Date.now());
}

export function texUrl(base: string, book: Pick<Book, 'id' | 'faces'>, side: Side) {
  const v = `${(book.faces || []).join('')}${version.get(book.id) || ''}`;
  return `${base}/api/books/${book.id}/tex/${side}.${side === 'spine' && !(book.faces || []).includes('spine') ? 'png' : 'jpg'}?v=${v}`;
}

export function pagesUrl(base: string) {
  return `${base}/api/tex/pages.jpg`;
}

function load(url: string): Promise<THREE.Texture | null> {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const fail = () => {
        setTimeout(() => cache.delete(url), 0); // let a later view retry (after cache.set below)
        resolve(null);
      };
      const timer = setTimeout(fail, 20000); // a load that never answers must not block forever
      try {
      new THREE.TextureLoader().load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          clearTimeout(timer);
          ready.set(url, t);
          resolve(t);
        },
        undefined,
        fail,
      );
      } catch {
        fail(); // a loader that throws must not leave a dead promise in the cache
      }
    });
    cache.set(url, p);
  }
  return p;
}

/** A shared, cached texture; returns the cached one synchronously when it's already in. */
export function useTexture(url?: string | null) {
  const [tex, setTex] = useState<THREE.Texture | null>(() => (url ? ready.get(url) ?? null : null));
  useEffect(() => {
    if (!url) {
      setTex(null);
      return;
    }
    const hit = ready.get(url);
    if (hit) {
      setTex(hit);
      return;
    }
    let alive = true;
    load(url).then((t) => alive && setTex(t));
    return () => {
      alive = false;
    };
  }, [url]);
  return tex;
}

/** Warm the cache for a list of books (e.g. spines as the Library opens). */
export function preload(base: string, books: Book[], side: Side) {
  books.forEach((b) => load(texUrl(base, b, side)));
}

/** True when every one of these textures is already in memory (nothing to wait for). */
export function allReady(base: string, books: Book[], side: Side) {
  return books.every((b) => ready.has(texUrl(base, b, side)));
}

/** Resolves once these textures have loaded (or failed: a missing one never blocks). */
export function loadAll(base: string, books: Book[], side: Side) {
  return Promise.all(books.map((b) => load(texUrl(base, b, side)))).then(() => undefined);
}

let _shadow: THREE.Texture | null = null;
/** A soft radial contact shadow, generated once on the device (no download). */
export function shadowTexture() {
  if (_shadow) return _shadow;
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - r, 2.2);
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = Math.round(a * 255);
    }
  _shadow = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  _shadow.needsUpdate = true;
  return _shadow;
}
