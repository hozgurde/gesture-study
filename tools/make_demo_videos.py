"""Make placeholder videos so you can test the study before your real renders exist.

Creates raw_videos/<system>__<clip>.mp4 : 3 systems x 4 clips, 4 seconds each,
with a moving dot and the system/clip name printed on the frame.
That file-name pattern (system__clip.mp4) is what prepare_stimuli.py expects.

Usage:  python tools/make_demo_videos.py
Needs:  ffmpeg on your PATH
"""
import os
import subprocess
from pathlib import Path

# Some ffmpeg builds (e.g. the Windows ones) have no fontconfig, so drawtext crashes
# without an explicit font. Use the first font found; otherwise leave it to ffmpeg.
# Set DEMO_FONT=/path/to/font.ttf to override.
FONT_CANDIDATES = [
    os.environ.get("DEMO_FONT", ""),
    os.path.join(os.environ.get("WINDIR", "C:/Windows"), "Fonts", "arial.ttf"),  # Windows
    "/System/Library/Fonts/Supplemental/Arial.ttf",                             # macOS
    "/Library/Fonts/Arial.ttf",                                                 # macOS (older)
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",                          # Debian/Ubuntu
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",                                   # Fedora
    "/usr/share/fonts/TTF/DejaVuSans.ttf",                                      # Arch
]


def font_option():
    for f in FONT_CANDIDATES:
        if f and Path(f).is_file():
            # ffmpeg filter syntax: forward slashes, and escape ':' (e.g. a drive letter).
            return "fontfile='" + Path(f).as_posix().replace(":", "\\:") + "':"
    return ""


FONT = font_option()

OUT = Path("raw_videos")
SYSTEMS = {"GT": "0x2d4a3e", "ModelA": "0x3e2d4a", "ModelB": "0x4a3e2d"}
CLIPS = ["clip01", "clip02", "clip03", "clip04"]
SECONDS = 4

OUT.mkdir(exist_ok=True)
for system, color in SYSTEMS.items():
    for i, clip in enumerate(CLIPS):
        speed = 80 + 40 * i
        vf = (
            f"drawbox=x='240+150*sin(t*{speed}/60)':y='180+90*cos(t*{speed}/45)':w=30:h=30:color=white:t=fill,"
            f"drawtext={FONT}text='{system}  {clip}':fontcolor=white:fontsize=34:x=20:y=20,"
            f"drawtext={FONT}text='%{{pts\\:hms}}':fontcolor=white@0.7:fontsize=24:x=20:y=320"
        )
        out = OUT / f"{system}__{clip}.mp4"
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-f", "lavfi", "-i", f"color=c={color}:s=640x480:r=30:d={SECONDS}",
             "-vf", vf, "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out)],
            check=True,
        )
        print("wrote", out)
