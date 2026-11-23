"""The marble busts' head-and-shoulders: a real 3D head scan, served compactly.

Model: "Infinite, 3D Head Scan" by Lee Perry-Smith (www.ir-ltd.net), based on
a work at www.triplegangers.com, licensed CC BY 3.0. Credited in the app.

The GLB is converted once into a tiny binary the phone can turn straight into
a BufferGeometry with fetch() (no glTF loader, no textures):
  header  uint32 magic 'BUST', uint32 nVerts, uint32 nIdx, uint32 jsonLen
  json    {"head": {"cx","cy","cz","rx","ry","rz"}, "height": H, "faceZ": z}
  data    float32 positions[nVerts*3]  int8 normals[nVerts*4]  uint16 indices[nIdx]
Units: the bust stands 1.75 tall with its base at y = 0, face toward +Z.
"""

from __future__ import annotations

import json
import struct
from functools import lru_cache

import numpy as np

from config import DATA_DIR

SRC = DATA_DIR / "models" / "head_scan.glb"
HEIGHT = 1.75


def _read_glb(path):
    b = path.read_bytes()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bin_ = b[20 + n + 8:]

    def acc(i):
        a = j["accessors"][i]
        v = j["bufferViews"][a["bufferView"]]
        off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
        k = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
        x = np.frombuffer(bin_, dtype=dt, count=a["count"] * k, offset=off)
        return x.reshape(-1, k) if k > 1 else x

    p = j["meshes"][0]["primitives"][0]
    return acc(p["attributes"]["POSITION"]).astype(np.float32), acc(p["attributes"]["NORMAL"]).astype(np.float32), \
        acc(p["indices"]).astype(np.uint32)


@lru_cache(maxsize=1)
def bust_bin() -> bytes:
    P, N, I = _read_glb(SRC)
    lo, hi = P.min(0), P.max(0)
    s = HEIGHT / (hi[1] - lo[1])
    P = (P - np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2], np.float32)) * s
    # the head: everything above the narrowest part of the neck
    ys = np.linspace(0.35, 1.2, 40)
    widths = [np.ptp(P[(P[:, 1] > y - 0.02) & (P[:, 1] < y + 0.02), 0]) if ((P[:, 1] > y - 0.02) & (P[:, 1] < y + 0.02)).any() else 9
              for y in ys]
    neck = float(ys[int(np.argmin(widths))])
    H = P[P[:, 1] > neck + 0.12]
    skull = P[P[:, 1] > neck + 0.35]          # above the ears: for hair and headwear
    head = {
        "cx": float((H[:, 0].min() + H[:, 0].max()) / 2), "cy": float((skull[:, 1].min() + H[:, 1].max()) / 2),
        "cz": float((skull[:, 2].min() + skull[:, 2].max()) / 2),
        "rx": float(np.ptp(skull[:, 0]) / 2), "ry": float((H[:, 1].max() - skull[:, 1].min()) / 2 + 0.06),
        "rz": float(np.ptp(skull[:, 2]) / 2), "top": float(H[:, 1].max()), "neck": neck,
        "chin": float(H[:, 1].min()),
    }
    meta = json.dumps({"head": head, "height": HEIGHT, "faceZ": float(H[:, 2].max()),
                       "credit": "Head scan: Lee Perry-Smith (ir-ltd.net), CC BY 3.0"}).encode()
    meta += b" " * ((4 - len(meta) % 4) % 4)
    n8 = np.zeros((len(N), 4), np.int8)
    n8[:, :3] = np.clip(np.round(N / np.linalg.norm(N, axis=1, keepdims=True) * 127), -127, 127).astype(np.int8)
    idx = I.astype(np.uint16)
    out = struct.pack("<4sIII", b"BUST", len(P), len(idx), len(meta)) + meta + P.astype("<f4").tobytes() \
        + n8.tobytes() + idx.astype("<u2").tobytes()
    return out


if __name__ == "__main__":
    b = bust_bin()
    n = struct.unpack("<I", b[12:16])[0]
    print(len(b), "bytes", json.loads(b[16:16 + n]))
