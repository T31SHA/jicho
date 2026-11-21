#!/usr/bin/env python3
"""Create the deterministic, original JichoBot sound set in place."""
from __future__ import annotations
import argparse, hashlib, math, struct, wave
from pathlib import Path
RATE = 48_000
ROOT = Path(__file__).resolve().parents[1]

def render(key: str) -> bytes:
    digest = hashlib.sha256(('JichoBot/Kito/' + key).encode()).digest()
    base = 260 + int.from_bytes(digest[:2], 'big') % 720
    second = base * (1.25 + digest[2] / 1024)
    duration = 0.09 + digest[3] / 255 * 0.17
    n = int(RATE * duration)
    frames = bytearray()
    for i in range(n):
        t = i / RATE
        x = i / max(1, n - 1)
        env = min(1.0, x * 18) * max(0.0, (1 - x) ** (1.6 + (digest[4] / 255)))
        if key in {'greet','greeting','approval','approve','finish','proud','love'}:
            phase = 0.5 + 0.5 * math.sin(t * math.pi * (3 + digest[5] % 3) / duration)
            f = base + (second - base) * phase
        else:
            f = base + (second - base) * x
        tone = math.sin(2 * math.pi * f * t) * 0.72 + math.sin(2 * math.pi * f * 1.51 * t) * 0.18
        sample = int(max(-1, min(1, tone * env * 0.27)) * 32767)
        frames.extend(struct.pack('<hh', sample, sample))
    import io
    out = io.BytesIO()
    with wave.open(out, 'wb') as wav:
        wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(RATE); wav.writeframes(frames)
    return out.getvalue()

def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument('--check', action='store_true'); args = ap.parse_args()
    dirs = [ROOT/'JichoBot/Resources/sounds', ROOT/'android/app/src/main/res/raw']
    keys = sorted({p.stem for d in dirs if d.exists() for p in d.glob('*.wav')})
    failures=[]
    for folder in dirs:
        if not folder.exists(): continue
        for key in keys:
            path=folder/f'{key}.wav'
            if not path.exists(): continue
            expected=render(key)
            if args.check:
                if path.read_bytes()!=expected: failures.append(str(path.relative_to(ROOT)))
            else: path.write_bytes(expected)
    if failures:
        print('Generated sounds are stale: ' + ', '.join(failures)); return 1
    print(f"{'Verified' if args.check else 'Generated'} deterministic original sounds for {len(keys)} sound keys.")
    return 0
if __name__=='__main__': raise SystemExit(main())
