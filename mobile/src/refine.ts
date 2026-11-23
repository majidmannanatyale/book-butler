// "AI decides WHAT, ML Kit decides WHERE."
// After a photo scan, run Google ML Kit text recognition on the same photo
// (on the phone, free, ~0.3 s) and snap every book's box onto the spine text
// that actually spells its title. Picks with no printed evidence are demoted.
import type { ScanResult, SpottedBook } from '@/api';

type Block = { text: string; x: number; y: number; w: number; h: number };

let recognizer: ((o: { uri: string }) => Promise<any>) | null | undefined;

function getRecognizer() {
  if (recognizer !== undefined) return recognizer;
  try {
    // only exists in the development build (native module)
    recognizer = require('react-native-vision-camera-ocr-plus').PhotoRecognizer;
  } catch {
    recognizer = null;
  }
  return recognizer;
}

export const canRefine = () => !!getRecognizer();

const STOP = new Set(['the', 'and', 'of', 'a', 'an', 'in', 'to', 'on', 'for', 'or', 'by', 'with', 'my']);
const words = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

function coverage(title: string, author: string, text: string) {
  const tw = words(title).filter((w) => !STOP.has(w));
  if (!tw.length) return 0;
  const bt = new Set(words(text));
  const hit = tw.filter((w) => bt.has(w)).length / tw.length;
  const surname = words(author).pop();
  return Math.min(1, hit + (surname && bt.has(surname) ? 0.2 : 0));
}

/** Join text blocks that sit on the same upright spine. */
function mergeSpines(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of [...blocks].sort((a, c) => a.x - c.x)) {
    const prev = out[out.length - 1];
    const tall = (k: Block) => k.h > k.w * 1.3;
    if (prev && tall(prev) && tall(b)) {
      const overlap = Math.min(prev.x + prev.w, b.x + b.w) - Math.max(prev.x, b.x);
      if (overlap > 0.5 * Math.min(prev.w, b.w)) {
        const x = Math.min(prev.x, b.x);
        const y = Math.min(prev.y, b.y);
        out[out.length - 1] = {
          text: `${prev.text} ${b.text}`,
          x,
          y,
          w: Math.max(prev.x + prev.w, b.x + b.w) - x,
          h: Math.max(prev.y + prev.h, b.y + b.h) - y,
        };
        continue;
      }
    }
    out.push({ ...b });
  }
  return out;
}

export async function refineWithOcr(result: ScanResult, uri: string, imgW: number, imgH: number): Promise<ScanResult> {
  const rec = getRecognizer();
  if (!rec || !imgW || !imgH) return result;
  let text: any;
  try {
    text = await rec({ uri });
  } catch {
    return result;
  }
  const raw: Block[] = (text?.blocks || []).map((b: any) => ({
    text: b.blockText,
    x: (b.blockFrame.boundingCenterX - b.blockFrame.width / 2) / imgW,
    y: (b.blockFrame.boundingCenterY - b.blockFrame.height / 2) / imgH,
    w: b.blockFrame.width / imgW,
    h: b.blockFrame.height / imgH,
  }));
  // ML Kit may report in rotated pixel space; detect by boxes falling outside 0..1 and swap.
  const outside = raw.filter((b) => b.x + b.w > 1.05 || b.y + b.h > 1.05).length;
  const blocks = mergeSpines(
    outside > raw.length / 3
      ? (text?.blocks || []).map((b: any) => ({
          text: b.blockText,
          x: (b.blockFrame.boundingCenterX - b.blockFrame.width / 2) / imgH,
          y: (b.blockFrame.boundingCenterY - b.blockFrame.height / 2) / imgW,
          w: b.blockFrame.width / imgH,
          h: b.blockFrame.height / imgW,
        }))
      : raw,
  );
  if (!blocks.length) return result;

  const used = new Set<number>();
  const books: SpottedBook[] = result.books.map((b) => {
    if (!b.title || b.status === 'unreadable') return b;
    let best = -1;
    let bestS = 0;
    blocks.forEach((k, i) => {
      if (used.has(i)) return;
      const s = coverage(b.title, b.author, k.text);
      if (s > bestS) {
        bestS = s;
        best = i;
      }
    });
    if (best >= 0 && bestS >= 0.5) {
      used.add(best);
      const k = blocks[best];
      // widen a little: text sits inside the spine
      const pad = 0.006;
      return {
        ...b,
        box: { x: Math.max(0, k.x - pad), y: Math.max(0, k.y - pad), w: Math.min(1, k.w + 2 * pad), h: Math.min(1, k.h + 2 * pad) },
        verified: true,
      } as SpottedBook;
    }
    if (b.status === 'pick') {
      // no printed evidence for this title on the photo -> don't recommend it
      return { ...b, status: 'candidate', note: 'Could not confirm this title on the spine.', stars: undefined };
    }
    return b;
  });
  return { ...result, books, refined: true } as ScanResult;
}
