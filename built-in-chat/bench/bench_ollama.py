#!/usr/bin/env python3
"""Run prompts.json through local Ollama models. Standard library only.

    python3 bench_ollama.py                      # phi4-mini, gemma3n:e2b, gemma3n:e4b
    python3 bench_ollama.py gemma4:e4b           # any models
    python3 bench_ollama.py --fresh phi4-mini    # discard saved results for that model

One JSONL file per model in results/, one line per item, written as each finishes.
A re-run skips items already on disk, and refuses to append if the file came from a
different prompt set or settings (use --fresh). Rebuilds results/index.json at the end.
"""
import argparse, hashlib, json, math, re, statistics, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"
OLLAMA = "http://127.0.0.1:11434"
DEFAULT_MODELS = ["phi4-mini", "gemma3n:e2b", "gemma3n:e4b"]
NUM_PREDICT = 2048  # runaway guard only; the Prompt API has no output cap
SEED = 42
TIMEOUT_S = 180

# ---------------------------------------------------------------- scorers (mirror of score.js)
STRIP = "\"'`*_“”‘’ \t\r\n"

def strip_ends(s):
    a, b = 0, len(s)
    while a < b and s[a] in STRIP: a += 1
    while b > a and s[b - 1] in STRIP + ".!?": b -= 1
    return s[a:b]

def last_number(s):
    t = re.sub(r"(\d),(?=\d{3}(?!\d))", r"\1", s.replace("−", "-"))
    m = re.findall(r"-?\d+(?:\.\d+)?", t)
    return float(m[-1]) if m else None

def strip_fences(s):
    m = re.match(r"^```[a-zA-Z]*\s*([\s\S]*?)\s*```$", s.strip())
    return m.group(1) if m else s.strip()

def same(a, b):
    if isinstance(a, str) and isinstance(b, str): return a.strip().lower() == b.strip().lower()
    if isinstance(a, bool) or isinstance(b, bool): return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)): return a == b
    return a == b

def score(item, out):
    out = out or ""
    s = item["scorer"]
    if s == "exact": return strip_ends(out).lower() == str(item["expect"]).lower()
    if s == "exact_case": return out.strip() == item["expect"]
    if s == "number":
        n = last_number(out); return n is not None and abs(n - item["expect"]) < 1e-9
    if s == "word_count": return len(out.split()) == item["expect"]
    if s == "csv_set":
        got = {strip_ends(x).lower() for x in out.split(",")} - {""}
        return got == {x.lower() for x in item["expect"]}
    if s == "json":
        try: obj = json.loads(strip_fences(out))
        except ValueError: return False
        return isinstance(obj, dict) and all(k in obj and same(obj[k], v) for k, v in item["expect"].items())
    if s == "timed": return None
    raise ValueError("Unknown scorer: " + s)

# ---------------------------------------------------------------- ollama
def post(path, body, stream=False):
    req = urllib.request.Request(OLLAMA + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=TIMEOUT_S)

def chat(model, system, prompt, options):
    """Stream one fresh chat. Returns (text, ttft_ms, total_ms, final_chunk)."""
    body = {"model": model, "stream": True, "think": False, "keep_alive": "10m", "options": options,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}]}
    t0 = time.perf_counter(); ttft = None; parts = []; final = {}
    with post("/api/chat", body) as r:
        for line in r:
            if not line.strip(): continue
            d = json.loads(line)
            if d.get("error"): raise RuntimeError(d["error"])
            c = d.get("message", {}).get("content", "")
            if c:
                if ttft is None: ttft = (time.perf_counter() - t0) * 1000
                parts.append(c)
            if d.get("done"): final = d
    return "".join(parts), ttft, (time.perf_counter() - t0) * 1000, final

def ollama_version():
    with urllib.request.urlopen(OLLAMA + "/api/version", timeout=10) as r: return json.load(r)["version"]

def model_detail(model):
    with post("/api/show", {"model": model}) as r: d = json.load(r)
    det = d.get("details", {})
    if d.get("remote_host"): raise SystemExit(f"{model} is a cloud model (remote_host); refusing.")
    return {"family": det.get("family"), "parameter_size": det.get("parameter_size"),
            "quantization": det.get("quantization_level"), "format": det.get("format")}

# ---------------------------------------------------------------- run
def fmt_s(sec):
    return "--" if sec is None or math.isnan(sec) else f"{int(sec // 60)}m{int(sec % 60):02d}s"

def load_existing(path, key):
    if not path.exists(): return {}
    done = {}
    for n, line in enumerate(path.read_text().splitlines(), 1):
        if not line.strip(): continue
        r = json.loads(line)
        k = {f: r.get(f) for f in key}
        want = {f: key[f] for f in key}
        if k != want:
            diff = ", ".join(f"{f}: file={k[f]!r} now={want[f]!r}" for f in key if k[f] != want[f])
            raise SystemExit(f"{path.name} line {n} is from a different run ({diff}).\n"
                             f"Re-run with --fresh to discard it, or move the file away.")
        if not r.get("error"): done[r["id"]] = r
    return done

def run_model(model, ps, set_hash, version, fresh):
    items = ps["items"]
    settings_req = {**ps["settings"], "seed": SEED, "num_predict": NUM_PREDICT}
    options = {"temperature": ps["settings"]["temperature"], "top_k": ps["settings"]["topK"],
               "seed": SEED, "num_predict": NUM_PREDICT}
    path = RESULTS / ("ollama-" + re.sub(r"[^A-Za-z0-9.]+", "-", model) + ".jsonl")
    key = {"set_hash": set_hash, "model_label": model, "settings_used": settings_req}
    if fresh and path.exists(): path.unlink()
    done = load_existing(path, key)
    if done:  # rewrite without errored lines so retries don't duplicate
        path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in done.values()))
    todo = [it for it in items if it["id"] not in done]
    detail = model_detail(model)
    print(f"\n== {model} ({detail['parameter_size']}, {detail['quantization']}) — {len(done)} saved, {len(todo)} to run")
    if not todo: return

    t = time.perf_counter()
    chat(model, ps["system"], "Say OK.", options)  # warm-up: loads the model, not recorded
    print(f"   warm-up {time.perf_counter() - t:.1f}s")

    passes = sum(1 for r in done.values() if r["pass"]); scored = sum(1 for r in done.values() if r["pass"] is not None)
    t_start = time.perf_counter()
    with path.open("a") as f:
        for i, it in enumerate(todo, 1):
            rec = {"kind": "result", "set_version": ps["version"], "set_hash": set_hash, "runtime": "ollama",
                   "runtime_version": version, "browser": None, "browser_version": None,
                   "model_label": model, "model_detail": detail,
                   "settings_requested": settings_req, "settings_used": settings_req,
                   "id": it["id"], "category": it["category"], "scorer": it["scorer"],
                   "ts": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            try:
                out, ttft, total, fin = chat(model, ps["system"], it["prompt"], options)
                gen_s = (fin.get("eval_duration") or 0) / 1e9
                ok = score(it, out)
                rec.update({"output": out, "chars": len(out), "ttft_ms": round(ttft or total, 1), "total_ms": round(total, 1),
                            "create_ms": None, "in_tokens": fin.get("prompt_eval_count"), "out_tokens": fin.get("eval_count"),
                            "tokens_source": "ollama eval_count",
                            "tok_per_s": round(fin["eval_count"] / gen_s, 2) if gen_s and fin.get("eval_count") else None,
                            "chars_per_s": round(len(out) / ((total - ttft) / 1000), 2) if ttft and total > ttft else None,
                            "pass": ok, "error": None})
                if ok is not None: scored += 1; passes += ok
            except Exception as e:  # recorded, retried on the next run
                rec.update({"output": None, "pass": None, "error": f"{type(e).__name__}: {e}"})
            f.write(json.dumps(rec, ensure_ascii=False) + "\n"); f.flush()
            el = time.perf_counter() - t_start
            eta = el / i * (len(todo) - i)
            mark = {True: "pass", False: "FAIL", None: "timed"}[rec["pass"]] if not rec["error"] else "ERROR"
            print(f"   [{len(done) + i:>2}/{len(items)}] {it['id']:<18} {mark:<5} "
                  f"ttft {rec.get('ttft_ms') or 0:>6.0f}ms total {rec.get('total_ms') or 0:>6.0f}ms | "
                  f"score {passes}/{scored} | ETA {fmt_s(eta)}", flush=True)

def rebuild_index():
    files = sorted(p.name for p in RESULTS.glob("*.jsonl"))
    (RESULTS / "index.json").write_text(json.dumps({"files": files}, indent=2) + "\n")
    return files

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("models", nargs="*", default=DEFAULT_MODELS)
    ap.add_argument("--fresh", action="store_true", help="discard saved results for these models first")
    ap.add_argument("--index-only", action="store_true", help="just rebuild results/index.json")
    a = ap.parse_args()
    RESULTS.mkdir(exist_ok=True)
    if a.index_only:
        print("\n".join(rebuild_index())); return
    raw = (HERE / "prompts.json").read_bytes()
    ps = json.loads(raw)
    set_hash = hashlib.sha256(raw).hexdigest()[:12]
    version = ollama_version()
    print(f"prompt set v{ps['version']} ({set_hash}), {len(ps['items'])} items, Ollama {version}")
    for m in a.models:
        run_model(m, ps, set_hash, version, a.fresh)
    rebuild_index()

if __name__ == "__main__":
    main()
