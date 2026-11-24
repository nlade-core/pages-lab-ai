# Built-in model bench

This bench compares the browsers' built-in models (Gemini Nano in Chrome, Phi-4-mini in Edge) with
their nearest local Ollama models, using the same 21 prompts.

| File | What |
|---|---|
| `prompts.json` | The prompt set: 18 scored items (6 arithmetic, 5 extraction, 7 format) and 3 open-ended items that are timed only. Also holds the system prompt and settings. |
| `index.html` + `bench.js` | Browser runner, using the Prompt API. |
| `bench_ollama.py` | Ollama runner. Python standard library only. |
| `score.js` / the scorer block in `bench_ollama.py` | The same scorers, written twice. Change both together. |
| `compare.html` + `compare.js` | Tables from every JSONL in `results/`, plus any files you drop onto the page. |
| `compare.py` | The same summary as a Markdown table. It also rebuilds `results/index.json`. |

## Method

- **One fresh session per item** (one stateless `/api/chat` call on Ollama), with system prompt
  "You are a helpful, concise assistant." A warm-up prompt runs first and isn't recorded.
- **Settings.** Both runners ask for temperature 0 and topK 1. Ollama also gets seed 42 and a
  `num_predict` cap of 2048, which only stops runaway output. In the browser, `create()` is tried
  with temperature/topK first. If it rejects them, the bench falls back to the browser's defaults.
  Each line records what was accepted (`settings_used.temperature_topK_passed`) and what the session
  reports (`session_temperature`/`session_topK`; null means the browser doesn't say).
- **Metrics.**
  - Time to first token and total time, both wall clock from sending the prompt.
  - Session creation time (browser only).
  - Output characters, and pass/fail.
  - Tokens. Ollama: `prompt_eval_count`/`eval_count`. Browser: `measureInputUsage()` on the prompt,
    and on the reply text as an estimate of output tokens.
  - Throughput in the tables uses the 3 open-ended items only. Single-word answers arrive in one or
    two chunks, so their rate is noise.
- **Scorers** (defined in `prompts.json`) are deliberately literal: `exact`, `exact_case`, `number`
  (last number in the reply), `word_count`, `csv_set`, `json` (code fences allowed, nothing else).
  A right answer in the wrong format fails. That is the point of the format items.
- **Resume and guard.** Results are written one line per item, as each finishes. A re-run skips
  items already saved and retries errors. It refuses to add to results from a different prompt set
  (SHA-256 of `prompts.json`), model, or settings. In the browser the browser and its version are
  also checked, because a browser update can change the model.

## Results so far (2026-11-24, Ollama 0.40.18, MacBook, Q4_K_M)

| Model | Stand-in for | Score | Arith. | Extract. | Format | Median TTFT | Median total | Chars/s (open) | Tok/s (open) |
|---|---|---|---|---|---|---|---|---|---|
| phi4-mini (3.8B) | Edge's Phi-4-mini, same weights | 15/18 | 4/6 | 5/5 | 6/7 | 46 ms | 122 ms | 350 | 70 |
| gemma3n:e2b (4.5B) | Nano relative | 15/18 | 4/6 | 5/5 | 6/7 | 134 ms | 215 ms | 274 | 63 |
| gemma3n:e4b (6.9B) | Nano relative | 17/18 | 6/6 | 5/5 | 6/7 | 213 ms | 320 ms | 181 | 44 |
| gemma4:e4b (8.0B) | newer Nano relative | 18/18 | 6/6 | 5/5 | 7/7 | 120 ms | 208 ms | 215 | 51 |
| Gemini Nano (Chrome) | — | *to run* | | | | | | | |
| Phi-4-mini (Edge) | — | *to run* | | | | | | | |

Failures worth knowing about:
- **phi4-mini** got `arith-sum` wrong (90 instead of 108) and `arith-time` wrong (13:15 instead of
  12:15). On `format-five-words` it wrote three words.
- **gemma3n:e2b** got `arith-pens` wrong (£9.00 instead of 8) and `arith-sum` wrong (98).
  `format-json` failed only because Ollama's output for gemma3n contains literal `▁` (U+2581)
  characters where there should be spaces: a detokenizer bug in Ollama, not a model error. The
  scorer is left strict, so it fails. Read it as 16/18 for the model itself. Gemini Nano in Chrome
  won't have this artefact.
- **gemma3n:e4b** wrote six words for `format-five-words`.

## What can't be compared directly

- **Runtimes and builds differ.** Ollama runs 4-bit GGUF on llama.cpp/Metal. Chrome and Edge run
  their own builds of their models, with their own compression. Even phi4-mini (Ollama) and
  Phi-4-mini (Edge), the same weights, are not the same binary or quantisation.
- **Nano's weights aren't public.** The gemma rows are relatives, not Nano.
- **Settings may differ.** Chrome has limited temperature/topK to extensions and origin trials,
  and may reject or ignore them on ordinary pages. Its default sampling is not greedy, so
  browser scores may move between runs. Check `settings_used` before reading a difference.
- **Tokens differ.** The Prompt API gives no output-token count or server-side timing. The
  browser's tok/s is a tokenizer count of the reply divided by wall-clock time. Ollama's is
  `eval_count` over `eval_duration`. Compare chars/s across runtimes.
- **n = 1, 18 scored items.** A gap of one or two items is noise. Fifteen versus eighteen hints at
  something; it doesn't rank the models.

## Running it

**Ollama** (from this folder; needs Ollama running locally):

```bash
python3 bench_ollama.py                       # phi4-mini, gemma3n:e2b, gemma3n:e4b
python3 bench_ollama.py gemma4:e4b            # any other local model
python3 bench_ollama.py --fresh phi4-mini     # discard and redo one model
```

**Chrome and Edge** (each on a machine where the built-in chat page already works):

1. Open https://nlade-core.github.io/pages-lab-ai/built-in-chat/bench/
2. Close other heavy tabs. Wait until the status says the model is **ready**. If it says it needs to
   download, Run starts the download first.
3. Press **Run**. 21 items, roughly 1–3 minutes. Stop and Resume are safe: results are saved after
   each item.
4. Press **Download JSONL**. You get `bench-chrome-<version>-<hash>.jsonl` or
   `bench-edge-<version>-<hash>.jsonl`.
5. Put the file in `built-in-chat/bench/results/` and run `python3 compare.py` to add it to the
   index and print the table. Or drop the file onto
   [compare](https://nlade-core.github.io/pages-lab-ai/built-in-chat/bench/compare.html) to look
   without committing.

## Related earlier work

- `local-model-arena/bench`: deterministic structured-extraction scoring of Ollama models, Apple
  FoundationModels and Chrome Nano (Nano run at defaults). Quality only, no timing, no Edge.
- `chrome-chat/eval`: Ollama stand-ins for Nano in that app's own features.

What this bench adds: Edge's Phi-4-mini compared with the same weights in Ollama, speed measured
the same way on both sides, and a format-following check.
