"""Cut the book out of a hand-held photo, so the 3D model shows just the book.

Plain OpenCV, no AI, $0. Book edges are long straight lines even when a thumb
covers part of one, while marble, carpet and hands are not. So:
  1. find straight segments (Canny + probabilistic Hough),
  2. find the photo's dominant angle and rotate the segments to be axis-aligned,
  3. try every left/right x top/bottom pairing and score each rectangle by how
     much of its outline is real edge, how book-shaped it is, and its size,
  4. flatten the winner.
If nothing convincing turns up the photo is kept as is: a crop never makes it worse.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

MAX = 640
MIN_SCORE = 0.30


def _segments(gray: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    blur = cv2.bilateralFilter(gray, 7, 40, 7)
    edges = cv2.Canny(blur, 25, 80)
    H, W = gray.shape
    segs = cv2.HoughLinesP(edges, 1, np.pi / 360, threshold=35,
                           minLineLength=int(0.10 * max(H, W)), maxLineGap=14)
    segs = np.zeros((0, 4)) if segs is None else segs.reshape(-1, 4).astype(np.float32)
    support = cv2.dilate(edges, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    return segs, support


def _dominant_angle(segs: np.ndarray) -> float:
    """Angle (radians, in [-45°, 45°)) that most long segments are parallel/perpendicular to."""
    if not len(segs):
        return 0.0
    dx, dy = segs[:, 2] - segs[:, 0], segs[:, 3] - segs[:, 1]
    ang = np.degrees(np.arctan2(dy, dx)) % 90          # fold parallel + perpendicular together
    ang = np.where(ang >= 45, ang - 90, ang)
    w = np.hypot(dx, dy)
    hist, bins = np.histogram(ang, bins=90, range=(-45, 45), weights=w)
    hist = np.convolve(np.r_[hist[-2:], hist, hist[:2]], np.ones(5), "valid")
    return math.radians(bins[int(hist.argmax())] + 0.5)


def _rot(pts: np.ndarray, a: float, c: tuple[float, float]) -> np.ndarray:
    ca, sa = math.cos(a), math.sin(a)
    p = pts - c
    return np.c_[p[:, 0] * ca - p[:, 1] * sa, p[:, 0] * sa + p[:, 1] * ca] + c


def _positions(vals: list[tuple[float, float]], tol: float) -> list[float]:
    """Merge nearby line positions (weighted by length); strongest first."""
    vals.sort()
    groups: list[list[tuple[float, float]]] = []
    for v in vals:
        if groups and v[0] - groups[-1][-1][0] <= tol:
            groups[-1].append(v)
        else:
            groups.append([v])
    out = [(sum(p * w for p, w in g) / sum(w for _, w in g), sum(w for _, w in g)) for g in groups]
    out.sort(key=lambda x: -x[1])
    return [p for p, _ in out[:14]]


def _coverage(support: np.ndarray, p0: np.ndarray, p1: np.ndarray) -> float:
    n = max(8, int(np.hypot(*(p1 - p0)) / 3))
    xs = np.linspace(p0[0], p1[0], n).round().astype(int)
    ys = np.linspace(p0[1], p1[1], n).round().astype(int)
    H, W = support.shape
    ok = (xs >= 0) & (xs < W) & (ys >= 0) & (ys < H)
    if ok.mean() < 0.9:
        return 0.0
    return float((support[ys[ok], xs[ok]] > 0).mean())


def find_book(img_bgr: np.ndarray, side: str = "front") -> tuple[np.ndarray | None, float]:
    """Return the book's corners (TL, TR, BR, BL) in full-image pixels, and a 0..1 confidence."""
    H0, W0 = img_bgr.shape[:2]
    scale = MAX / max(H0, W0)
    small = cv2.resize(img_bgr, (int(W0 * scale), int(H0 * scale)), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    H, W = gray.shape
    segs, support = _segments(gray)
    if len(segs) < 2:
        return None, 0.0
    a = _dominant_angle(segs)
    c = (W / 2, H / 2)
    p0 = _rot(segs[:, :2], -a, c)
    p1 = _rot(segs[:, 2:], -a, c)
    d = p1 - p0
    vert = np.abs(d[:, 0]) < np.abs(d[:, 1]) * 0.21     # within ~12° of the dominant axes
    horz = np.abs(d[:, 1]) < np.abs(d[:, 0]) * 0.21
    L = np.hypot(d[:, 0], d[:, 1])
    xs = _positions([((p0[i, 0] + p1[i, 0]) / 2, L[i]) for i in np.where(vert)[0]], 8)
    ys = _positions([((p0[i, 1] + p1[i, 1]) / 2, L[i]) for i in np.where(horz)[0]], 8)
    # the frame itself can stand in for an edge the camera cropped off
    xs = sorted(set(xs))
    ys = sorted(set(ys))
    best, best_s = None, 0.0
    for i, x0 in enumerate(xs):
        for x1 in xs[i + 1:]:
            w = x1 - x0
            if w < 0.08 * W:
                continue
            for j, y0 in enumerate(ys):
                for y1 in ys[j + 1:]:
                    h = y1 - y0
                    if h < 0.12 * H:
                        continue
                    ar = min(w, h) / max(w, h)
                    if side == "spine":
                        shape = 1.0 if 0.07 <= ar <= 0.34 else max(0.0, 1 - abs(ar - 0.2) * 3)
                    else:
                        shape = 1.0 if 0.56 <= ar <= 0.84 else max(0.0, 1 - min(abs(ar - 0.56), abs(ar - 0.84)) * 4)
                    if shape <= 0:
                        continue
                    rect = np.array([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], dtype=np.float32)
                    q = _rot(rect, a, c)
                    covs = [_coverage(support, q[k], q[(k + 1) % 4]) for k in range(4)]
                    if min(covs) < 0.18:      # a thumb may hide part of one side, not a whole side
                        continue
                    area = (w * h) / (W * H)
                    if area > 0.95:
                        continue
                    s = (sum(covs) / 4) * shape * (0.45 + 0.55 * min(1.0, area / 0.35) ** 0.5)
                    if s > best_s:
                        best, best_s = q / scale, s
    return best, best_s


def flatten(img_bgr: np.ndarray, q: np.ndarray, side: str) -> np.ndarray:
    tl, tr, br, bl = q
    w = int(round((np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2))
    h = int(round((np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2))
    dst = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32)
    out = cv2.warpPerspective(img_bgr, cv2.getPerspectiveTransform(q.astype(np.float32), dst), (w, h),
                              flags=cv2.INTER_CUBIC)
    if w > h:                       # books stand upright: covers portrait, spines tall
        out = cv2.rotate(out, cv2.ROTATE_90_CLOCKWISE)
    m = max(1, int(min(out.shape[:2]) * 0.012))   # shave a hair so no background shows
    return out[m:-m, m:-m]


def crop_book(img_bgr: np.ndarray, side: str = "front") -> tuple[np.ndarray, bool, float]:
    q, s = find_book(img_bgr, side)
    if q is None or s < MIN_SCORE:
        return img_bgr, False, s
    return flatten(img_bgr, q, side), True, s


# ----------------------------------------------------------- AI-guided crop
# The vision model is good at *where* the book is (and at ignoring the hand);
# OpenCV is good at *exactly* where its edges are. Use both.

def _find_in_region(img_bgr: np.ndarray, side: str, min_area: float) -> tuple[np.ndarray | None, float]:
    q, s = find_book(img_bgr, side)
    if q is None:
        return None, 0.0
    H, W = img_bgr.shape[:2]
    if cv2.contourArea(q.astype(np.float32)) / (W * H) < min_area:
        return None, 0.0
    return q, s


def crop_with_box(img_bgr: np.ndarray, box: tuple[int, int, int, int], side: str) -> tuple[np.ndarray, str]:
    """box = (x0, y0, x1, y1) normalised 0..1000. Returns (image, how)."""
    H, W = img_bgr.shape[:2]
    x0, y0, x1, y1 = box
    if x1 - x0 < 40 or y1 - y0 < 40:
        return img_bgr, "none"
    pad = 0.04
    bx0 = max(0, int((x0 / 1000 - pad) * W)); by0 = max(0, int((y0 / 1000 - pad) * H))
    bx1 = min(W, int((x1 / 1000 + pad) * W)); by1 = min(H, int((y1 / 1000 + pad) * H))
    region = img_bgr[by0:by1, bx0:bx1]
    # trust the shape over the label: a very narrow box is a spine whatever the button said
    bw, bh = (x1 - x0) / 1000 * W, (y1 - y0) / 1000 * H
    side = "spine" if min(bw, bh) / max(bw, bh) < 0.4 else ("front" if side == "spine" else side)
    q, s = _find_in_region(region, side, min_area=0.15 if side == "spine" else 0.45)
    if q is not None and s >= 0.28:
        return flatten(region, q, side), "edges"
    g = _grabcut_rect(region, (int(x0 / 1000 * W) - bx0, int(y0 / 1000 * H) - by0,
                               int(x1 / 1000 * W) - bx0, int(y1 / 1000 * H) - by0), side)
    if g is not None:
        return flatten(region, g, side), "grabcut"
    tight = img_bgr[int(y0 / 1000 * H):int(y1 / 1000 * H), int(x0 / 1000 * W):int(x1 / 1000 * W)]
    return tight, "box"


def _grabcut_rect(region: np.ndarray, r: tuple[int, int, int, int], side: str) -> np.ndarray | None:
    """Separate book from background inside the AI's box, drop skin, fit a (rotated) rectangle."""
    H0, W0 = region.shape[:2]
    sc = 360 / max(H0, W0)
    sm = cv2.resize(region, (max(8, int(W0 * sc)), max(8, int(H0 * sc))), interpolation=cv2.INTER_AREA)
    x0, y0, x1, y1 = [int(v * sc) for v in r]
    x0, y0 = max(1, x0), max(1, y0)
    x1, y1 = min(sm.shape[1] - 2, x1), min(sm.shape[0] - 2, y1)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    mask = np.zeros(sm.shape[:2], np.uint8)
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(sm, mask, (x0, y0, x1 - x0, y1 - y0), bgd, fgd, 4, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None
    fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    ycc = cv2.cvtColor(sm, cv2.COLOR_BGR2YCrCb)
    skin = cv2.inRange(ycc, (40, 140, 85), (235, 175, 125))
    fg[skin > 0] = 0
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    cnts, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.25 * (x1 - x0) * (y1 - y0) * (0.4 if side == "spine" else 1):
        return None
    box = _order(cv2.boxPoints(cv2.minAreaRect(c)))
    return box / sc


def _order(pts: np.ndarray) -> np.ndarray:
    """Corners as TL, TR, BR, BL, robust for near-45° rectangles."""
    pts = pts.reshape(4, 2).astype(np.float32)
    c = pts.mean(0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]                 # clockwise from the left in image coords
    i = int(np.argmin(pts.sum(1)))
    return np.roll(pts, -i, axis=0)
