#!/usr/bin/env python3
"""Summarise bench JSONL files as a Markdown table. Standard library only.

    python3 compare.py                 # every results/*.jsonl, also rebuilds results/index.json
    python3 compare.py a.jsonl b.jsonl

Drop JSONL files downloaded from the bench page into results/ and re-run this
(or just open compare.html, which reads results/index.json, or drag the files onto it).
"""
import json, statistics, sys
from collections import defaultdict
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / "results"

def med(xs):
    xs = [x for x in xs if x is not None]
    return statistics.median(xs) if xs else None

def f(x, unit="", nd=0):
    return "–" if x is None else f"{x:,.{nd}f}{unit}"

def main():
    paths = [Path(p) for p in sys.argv[1:]] or sorted(RESULTS.glob("*.jsonl"))
    if not sys.argv[1:]:
        (RESULTS / "index.json").write_text(json.dumps({"files": [p.name for p in paths]}, indent=2) + "\n")
    runs = defaultdict(list)
    for p in paths:
        for line in p.read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                runs[(r["runtime"], r["model_label"], r.get("browser_version") or r.get("runtime_version"), r["set_hash"])].append(r)
    print("| Model | Runtime | Set | Score | Median TTFT | Median total | Chars/s (open) | Tok/s (open) |")
    print("|---|---|---|---|---|---|---|---|")
    for (rt, label, ver, h), rs in sorted(runs.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        ok = [r for r in rs if not r.get("error")]
        sc = [r for r in ok if r["pass"] is not None]
        p = sum(1 for r in sc if r["pass"])
        op = [r for r in ok if r["category"] == "open"]  # short answers: no meaningful rate
        print(f"| {label} | {rt} {ver or ''} | {h[:6]} | {p}/{len(sc)} | {f(med(r['ttft_ms'] for r in ok), ' ms')} | "
              f"{f(med(r['total_ms'] for r in ok), ' ms')} | {f(med(r.get('chars_per_s') for r in op))} | "
              f"{f(med(r.get('tok_per_s') for r in op))} |")

if __name__ == "__main__":
    main()
