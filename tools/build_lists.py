"""Build balanced trial lists (this replaces Qualtrics Loop & Merge).

Reads tools/stimuli_manifest.csv (file, system, clip_id) and writes lists/list_<i>.json.

Design
  - Every pair of systems is compared on every clip (e.g. GT-vs-A, GT-vs-B, A-vs-B).
  - Comparisons are split across lists so each participant sees about --trials-per-list.
  - Lists come in mirrored pairs: list 2k and 2k+1 contain the same comparisons with
    left/right swapped, so screen side is perfectly counterbalanced.
  - Trial order is shuffled so the same clip never appears twice in a row (when possible).
  - --attention attention checks are inserted between 20% and 80% of the way through.
  - --systems lets you compare only some systems; --anchor X keeps only pairs that include X.

Usage
  python tools/build_lists.py                                  # local test (videos in stimuli/)
  python tools/build_lists.py --base-url https://pub-xxxx.r2.dev/ --trials-per-list 25
  python tools/build_lists.py --anchor Ours                    # only Ours-vs-others pairs

Then set N_LISTS in js/config.js (and in DataPipe) to the number it prints.
"""
import argparse
import csv
import itertools
import json
import math
import random
from collections import defaultdict
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--manifest", default="tools/stimuli_manifest.csv")
p.add_argument("--base-url", default="stimuli/", help="prefix for video URLs (end with /)")
p.add_argument("--trials-per-list", type=int, default=25)
p.add_argument("--attention", type=int, default=4)
p.add_argument("--n-choices", type=int, default=5, help="number of answer buttons")
p.add_argument("--systems", nargs="*", help="only use these systems")
p.add_argument("--anchor", help="only keep comparisons that include this system")
p.add_argument("--seconds-per-trial", type=float, default=30, help="for the time estimate")
p.add_argument("--seed", type=int, default=1)
p.add_argument("--out", default="lists")
args = p.parse_args()
rng = random.Random(args.seed)

# --- read manifest: clip -> system -> url ------------------------------------
by_clip = defaultdict(dict)
with open(args.manifest) as f:
    for r in csv.DictReader(f):
        if args.systems and r["system"] not in args.systems:
            continue
        by_clip[r["clip_id"]][r["system"]] = args.base_url + r["file"]

# --- all comparisons ---------------------------------------------------------
comparisons = []
for clip, systems in sorted(by_clip.items()):
    for a, b in itertools.combinations(sorted(systems), 2):
        if args.anchor and args.anchor not in (a, b):
            continue
        comparisons.append({"clip_id": clip, "a": a, "b": b, "src": systems})
if not comparisons:
    raise SystemExit("No comparisons. Check the manifest / --systems / --anchor.")

rng.shuffle(comparisons)
n_groups = max(1, math.ceil(len(comparisons) / args.trials_per_list))
groups = [comparisons[i::n_groups] for i in range(n_groups)]


def order_no_repeat(items):
    """Shuffle so consecutive trials use different clips (best effort)."""
    for _ in range(2000):
        rng.shuffle(items)
        if all(items[i]["clip_id"] != items[i + 1]["clip_id"] for i in range(len(items) - 1)):
            return items
    return items


def make_trial(c, swap, idx):
    # NOTE: lists are public (anyone can open lists/list_0.json), so they contain only the
    # hashed video URLs, never system or clip names. tools/decode_results.py adds those
    # back from the private manifest when you analyse the data.
    left, right = (c["b"], c["a"]) if swap else (c["a"], c["b"])
    return {
        "left": {"src": c["src"][left]},
        "right": {"src": c["src"][right]},
        "attention_target": None,
    }


def add_attention(trials):
    n = len(trials)
    if args.attention <= 0 or n < 2:
        return trials
    # positions spread between 20% and 80% of the list
    positions = sorted({round(n * (0.2 + 0.6 * k / max(1, args.attention - 1)))
                        for k in range(args.attention)}, reverse=True)
    for pos in positions:
        base = rng.choice(trials)
        chk = json.loads(json.dumps(base))
        chk["attention_target"] = rng.randrange(args.n_choices)
        trials.insert(pos, chk)
    return trials


out = Path(args.out)
out.mkdir(exist_ok=True)
for old in out.glob("list_*.json"):
    old.unlink()

list_idx = 0
for g in groups:
    ordered = order_no_repeat(list(g))
    swaps = [rng.random() < 0.5 for _ in ordered]
    for mirror in (False, True):  # mirrored twin swaps every left/right
        trials = [make_trial(c, s != mirror, i) for i, (c, s) in enumerate(zip(ordered, swaps))]
        trials = add_attention(trials)
        data = {
            "list_index": list_idx,
            "n_trials": len(trials),
            "estimated_minutes": math.ceil(len(trials) * args.seconds_per_trial / 60) + 3,
            "trials": trials,
        }
        (out / f"list_{list_idx}.json").write_text(json.dumps(data, indent=1))
        list_idx += 1

print(f"{len(comparisons)} comparisons -> {list_idx} lists "
      f"({n_groups} groups x 2 mirrored), ~{len(groups[0])} trials + {args.attention} checks each.")
print(f"Set N_LISTS = {list_idx} in js/config.js and 'Number of conditions' = {list_idx} in DataPipe.")
print(f"Each comparison is seen once per {list_idx} participants -> recruit in multiples of {list_idx}.")
