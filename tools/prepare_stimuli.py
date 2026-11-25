"""Compress your rendered clips for the web and give them meaningless file names.

Input:  a folder of videos named  <system>__<clip>.mp4
        e.g.  GT__clip01.mp4, ModelA__clip01.mp4, Ours__clip07.mp4
Output: <out_dir>/<hash>.mp4         (upload these to R2, or keep in stimuli/ for testing)
        tools/stimuli_manifest.csv   (PRIVATE mapping: hash -> system, clip. Don't upload it
                                      next to the videos; build_lists.py reads it.)

The hashed names stop participants from seeing the condition in the browser's dev tools.
The hash is derived from the original name + a secret salt, so re-running gives the same names.

Usage:
  python tools/prepare_stimuli.py raw_videos stimuli
  python tools/prepare_stimuli.py raw_videos stimuli --keep-audio      # appropriateness study
  python tools/prepare_stimuli.py raw_videos stimuli --height 720 --crf 23
"""
import argparse
import csv
import hashlib
import subprocess
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("in_dir")
p.add_argument("out_dir")
p.add_argument("--height", type=int, default=720)
p.add_argument("--crf", type=int, default=23, help="lower = better quality, bigger files")
p.add_argument("--keep-audio", action="store_true", help="keep speech audio (default: strip it)")
p.add_argument("--salt", default="change-this-secret", help="any secret string")
p.add_argument("--manifest", default="tools/stimuli_manifest.csv")
args = p.parse_args()

in_dir, out_dir = Path(args.in_dir), Path(args.out_dir)
out_dir.mkdir(parents=True, exist_ok=True)

rows = []
for src in sorted(in_dir.glob("*.mp4")):
    if "__" not in src.stem:
        print("skipping (name is not system__clip.mp4):", src.name)
        continue
    system, clip = src.stem.split("__", 1)
    h = hashlib.sha256((args.salt + src.name).encode()).hexdigest()[:12]
    dst = out_dir / f"{h}.mp4"

    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
           "-c:v", "libx264", "-crf", str(args.crf), "-preset", "slow",
           "-pix_fmt", "yuv420p", "-vf", f"scale=-2:{args.height}",
           "-movflags", "+faststart"]
    cmd += ["-c:a", "aac", "-b:a", "96k"] if args.keep_audio else ["-an"]
    subprocess.run(cmd + [str(dst)], check=True)

    size_mb = dst.stat().st_size / 1e6
    rows.append({"file": dst.name, "system": system, "clip_id": clip, "size_mb": f"{size_mb:.2f}"})
    print(f"{src.name:40s} -> {dst.name}  ({size_mb:.2f} MB)")

with open(args.manifest, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["file", "system", "clip_id", "size_mb"])
    w.writeheader()
    w.writerows(rows)

total = sum(float(r["size_mb"]) for r in rows)
print(f"\n{len(rows)} files, {total:.1f} MB total. Manifest: {args.manifest}")
