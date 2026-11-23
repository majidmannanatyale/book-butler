// On-device spine reading for the tap-to-freeze Book Finder.
//
// 1. Shrink the photo to a fixed upright working image (same pixels we show on screen).
// 2. Google ML Kit reads it three ways IN PARALLEL: turned for top→bottom spines,
//    turned for bottom→top spines, and as-is for flat books / covers.
// 3. Every box is turned back into the working image's coordinates and normalised
//    to 0..1, so it can be drawn exactly on the frozen image.
// Free, private (nothing uploaded), ~1–2 s on a Pixel.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** angle: degrees clockwise from vertical of the spine's long axis; len: axis length / image height. */
export type NBlock = { text: string; x: number; y: number; w: number; h: number; angle?: number; len?: number };

let recognize: ((o: { uri: string }) => Promise<any>) | null | undefined;

export function onDeviceAvailable(): boolean {
  if (recognize === undefined) {
    try {
      recognize = require('react-native-vision-camera-ocr-plus').PhotoRecognizer;
    } catch {
      recognize = null;
    }
  }
  return !!recognize;
}

type Raw = { text: string; x: number; y: number; w: number; h: number; pts?: { x: number; y: number }[] };

// NOTE: the plugin's blockFrame.x / .y are NOT the box corner (its native code
// mangles them: x = centreX/2, y = 1.5·centreY − h). The centre + size fields are
// correct, so we rebuild the box from those. Verified against a real shelf photo.
function readBlocks(res: any): Raw[] {
  return (res?.blocks || []).map((b: any) => {
    const f = b.blockFrame;
    return {
      text: String(b.blockText || ''),
      x: f.boundingCenterX - f.width / 2,
      y: f.boundingCenterY - f.height / 2,
      w: f.width,
      h: f.height,
      // corner points ARE reported correctly (pixel coords of the image ML Kit read)
      pts: (b.blockCornerPoints || []).map((q: any) => ({ x: q.x, y: q.y })),
    };
  });
}

/** Spine axis from the text's corner points: the long edge runs along the spine. */
function axis(pts?: { x: number; y: number }[]): { angle: number; len: number } | null {
  if (!pts || pts.length < 4) return null;
  const e1 = { dx: pts[1].x - pts[0].x, dy: pts[1].y - pts[0].y };
  const e2 = { dx: pts[2].x - pts[1].x, dy: pts[2].y - pts[1].y };
  const l1 = Math.hypot(e1.dx, e1.dy);
  const l2 = Math.hypot(e2.dx, e2.dy);
  let v = l1 >= l2 ? e1 : e2;
  if (v.dy < 0 || (v.dy === 0 && v.dx > 0)) v = { dx: -v.dx, dy: -v.dy }; // point "down" the spine
  return { angle: (Math.atan2(-v.dx, v.dy) * 180) / Math.PI, len: Math.max(l1, l2) };
}

/** Merge text blocks that sit on the same spine (vertical neighbours that overlap). */
function mergeSpines(blocks: NBlock[]): NBlock[] {
  const out: NBlock[] = [];
  for (const b of [...blocks].sort((a, c) => a.x - c.x)) {
    const prev = out[out.length - 1];
    const tall = (k: NBlock) => k.h > k.w * 1.3;
    if (prev && tall(prev) && tall(b)) {
      const overlap = Math.min(prev.x + prev.w, b.x + b.w) - Math.max(prev.x, b.x);
      if (overlap > 0.5 * Math.min(prev.w, b.w)) {
        const x = Math.min(prev.x, b.x);
        const y = Math.min(prev.y, b.y);
        const top = prev.y <= b.y ? [prev, b] : [b, prev];
        const longer = (prev.len || 0) >= (b.len || 0) ? prev : b;
        const h = Math.max(prev.y + prev.h, b.y + b.h) - y;
        const a = longer.angle || 0;
        out[out.length - 1] = {
          text: `${top[0].text} ${top[1].text}`,
          x,
          y,
          w: Math.max(prev.x + prev.w, b.x + b.w) - x,
          h,
          angle: a,
          len: h / Math.max(0.2, Math.cos((a * Math.PI) / 180)),
        };
        continue;
      }
    }
    out.push({ ...b });
  }
  return out;
}

const iou = (a: NBlock, b: NBlock) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

const letters = (t: string) => t.replace(/[^A-Za-z]/g, '').length;

export async function readShelf(photoUri: string, opts: { fast?: boolean; debug?: boolean } = {}): Promise<{
  uri: string;
  w: number;
  h: number;
  b64?: string;
  blocks: NBlock[];
  ms: number;
  raw?: any;
}> {
  const t0 = Date.now();
  if (!onDeviceAvailable()) throw new Error('On-device reading is not available in this build.');
  // fixed upright working image — the exact pixels we OCR and display
  const base = await (await ImageManipulator.manipulate(photoUri).resize({ width: 1200, height: null }).renderAsync()).saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.85,
    base64: __DEV__ && opts.debug !== false && !opts.fast,
  });
  const W = base.width;
  const H = base.height;

  const turned = async (deg: 0 | 90 | -90) => {
    if (deg === 0) return { uri: base.uri };
    return (await ImageManipulator.manipulate(base.uri).rotate(deg).renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  };
  // fast mode (recording sessions): upright + one turn is enough — ML Kit already
  // reads most vertical spines upright; the turn catches the rest.
  const [ccw, cw] = await Promise.all([turned(-90), opts.fast ? Promise.resolve(null as any) : turned(90)]);
  const [rCcw, rCw, rFlat] = await Promise.all([
    recognize!({ uri: ccw.uri }).catch(() => null),
    cw ? recognize!({ uri: cw.uri }).catch(() => null) : Promise.resolve(null),
    recognize!({ uri: base.uri }).catch(() => null),
  ]);

  // turn boxes back into the upright W×H working image
  //   CCW turn (-90): upright (x,y) -> turned (y, W-x)   => upright x = W-(yt+ht), y = xt
  //   CW  turn (+90): upright (x,y) -> turned (H-y, x)   => upright x = yt, y = H-(xt+wt)
  const fromCcw = readBlocks(rCcw).map((b) => ({
    text: b.text, x: W - (b.y + b.h), y: b.x, w: b.h, h: b.w,
    pts: b.pts?.map((q) => ({ x: W - q.y, y: q.x })),
  }));
  const fromCw = readBlocks(rCw).map((b) => ({
    text: b.text, x: b.y, y: H - (b.x + b.w), w: b.h, h: b.w,
    pts: b.pts?.map((q) => ({ x: q.y, y: H - q.x })),
  }));
  const flat = readBlocks(rFlat);

  const norm = (b: Raw): NBlock => {
    const ax = axis(b.pts);
    return {
      text: b.text,
      x: Math.max(0, b.x / W),
      y: Math.max(0, b.y / H),
      w: Math.min(1, b.w / W),
      h: Math.min(1, b.h / H),
      angle: ax ? ax.angle : b.h >= b.w ? 0 : 90,
      len: ax ? ax.len / H : Math.max(b.h, b.w) / H,
    };
  };

  // keep the best reading of each place on the shelf (most letters wins)
  const all = [...fromCcw, ...fromCw, ...flat].map(norm).filter((b) => letters(b.text) >= 3);
  all.sort((a, b) => letters(b.text) - letters(a.text));
  const kept: NBlock[] = [];
  for (const b of all) if (!kept.some((k) => iou(k, b) > 0.35)) kept.push(b);
  const blocks = mergeSpines(kept).filter((b) => letters(b.text) >= 4);

  const raw = __DEV__
    ? {
        base: { w: W, h: H },
        ccw: { w: (ccw as any).width, h: (ccw as any).height, blocks: readBlocks(rCcw) },
        cw: { w: (cw as any)?.width, h: (cw as any)?.height, blocks: readBlocks(rCw) },
        flat: { blocks: flat },
      }
    : undefined;
  return { uri: base.uri, w: W, h: H, b64: base.base64 || undefined, blocks, ms: Date.now() - t0, raw };
}
