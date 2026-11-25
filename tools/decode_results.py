"""Combine downloaded data files, add system/clip names back, apply exclusions, summarise.

Usage:
  python tools/decode_results.py results/            # folder of CSVs from OSF (or test downloads)

Writes results/combined.csv and prints:
  - participants, attention-check failures (exclude: failed any; reject on Prolific: failed >1)
  - per system pair: how often each side won, ties, and mean preference score
  - per system: overall win rate

Scoring (5 buttons, left to right): +2, +1, 0, -1, -2 in favour of the LEFT video.
"""
import csv
import sys
from collections import defaultdict
from pathlib import Path

folder = Path(sys.argv[1] if len(sys.argv) > 1 else "results")
manifest_path = Path(sys.argv[2] if len(sys.argv) > 2 else "tools/stimuli_manifest.csv")

key = {}
with open(manifest_path) as f:
    for r in csv.DictReader(f):
        key[r["file"]] = (r["system"], r["clip_id"])

LEFT_SCORE = {0: 2, 1: 1, 2: 0, 3: -1, 4: -2}
rows = []
for path in sorted(folder.glob("*.csv")):
    if path.name == "combined.csv":
        continue
    with open(path) as f:
        for r in csv.DictReader(f):
            if r.get("task") != "pairwise":
                continue
            lf = r["left_src"].rsplit("/", 1)[-1]
            rf = r["right_src"].rsplit("/", 1)[-1]
            if lf not in key or rf not in key:
                print("WARNING: video not in manifest:", lf, rf)
                continue
            r["left_system"], r["clip_id"] = key[lf]
            r["right_system"], _ = key[rf]
            r["source_file"] = path.name
            rows.append(r)

if not rows:
    sys.exit(f"No pairwise trials found in {folder}/")

# --- attention checks -------------------------------------------------------------
fails = defaultdict(int)
people = set()
for r in rows:
    pid = (r["prolific_pid"], r["session_id"])
    people.add(pid)
    if r["is_attention"] == "true" and r["attention_passed"] != "true":
        fails[pid] += 1
excluded = {p for p, n in fails.items() if n >= 1}
reject = {p for p, n in fails.items() if n > 1}
print(f"Participants: {len(people)}   excluded (failed >=1 check): {len(excluded)}   "
      f"reject on Prolific (failed >1): {len(reject)}")
for p in sorted(reject):
    print("   reject:", p[0])

# --- write combined file ------------------------------------------------------------
out = folder / "combined.csv"
fields = list(rows[0].keys())
for extra in ("excluded",):
    fields.append(extra)
with open(out, "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        r["excluded"] = (r["prolific_pid"], r["session_id"]) in excluded
        w.writerow(r)
print("Wrote", out)

# --- summaries (real trials from included participants) ------------------------------
pairs = defaultdict(lambda: {"a_wins": 0, "ties": 0, "b_wins": 0, "score": 0, "n": 0})
wins = defaultdict(lambda: [0, 0])  # system -> [wins, comparisons]
for r in rows:
    if r["is_attention"] == "true" or r["excluded"]:
        continue
    s = LEFT_SCORE[int(r["response"])]
    a, b = sorted([r["left_system"], r["right_system"]])
    s_for_a = s if r["left_system"] == a else -s
    d = pairs[(a, b)]
    d["n"] += 1
    d["score"] += s_for_a
    if s_for_a > 0:
        d["a_wins"] += 1; wins[a][0] += 1
    elif s_for_a < 0:
        d["b_wins"] += 1; wins[b][0] += 1
    else:
        d["ties"] += 1
    wins[a][1] += 1; wins[b][1] += 1

print(f"\n{'A':>10} vs {'B':<10} {'n':>4} {'A wins':>7} {'ties':>6} {'B wins':>7} {'mean score (+ favours A)':>26}")
for (a, b), d in sorted(pairs.items()):
    n = d["n"]
    print(f"{a:>10} vs {b:<10} {n:>4} {d['a_wins']/n:>7.0%} {d['ties']/n:>6.0%} {d['b_wins']/n:>7.0%} {d['score']/n:>26.2f}")

print("\nOverall win rate (ties count as non-wins):")
for sname, (w_, n) in sorted(wins.items(), key=lambda x: -x[1][0] / x[1][1]):
    print(f"   {sname:12s} {w_/n:.0%}  ({w_}/{n})")
