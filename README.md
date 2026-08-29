# pages-lab-ai

In-browser AI demos, zero backend. Sequel to [pages-lab](https://github.com/nlade-core/pages-lab) and
[pages-pyodide](https://github.com/nlade-core/pages-pyodide) — JS-native this time (transformers.js /
ONNX Runtime Web), not Pyodide, since real model inference needs GPU/WASM acceleration Pyodide's
CPU-only Python can't give it.

## Live

- [Image classifier](https://nlade-core.github.io/pages-lab-ai/) — MobileNetV2 (2018), 1000 ImageNet
  classes, photo upload or live webcam. Runs full fp32 weights: this model's published int8/uint8
  quantized exports were verified broken before shipping (confidently mislabeled obvious test photos —
  e.g. a clear black lab puppy called "spotlight" at 44% confidence). Webcam mode throttles to every
  5th real camera frame via `requestVideoFrameCallback`, same trick as pages-pyodide's live mode.
  **Parked here for now** — status quo, not actively being extended.
- [Semantic search](https://nlade-core.github.io/pages-lab-ai/semantic-search/) — MiniLM sentence
  embeddings (int8-quantized, ~23MB). Index a corpus, then rank it against a typed query by cosine
  similarity — ranks meaning, not keyword overlap. Unlike MobileNetV2's, this model's quantized export
  checked out fine against fp32 before shipping (quantization damages depthwise convs specifically, not
  the linear/attention layers a sentence transformer is built from).
- [Chat](https://nlade-core.github.io/pages-lab-ai/chat/) — a real LLM (Llama 3.2 or Qwen3.5, your
  choice of a 1B/3B/9B size tier, disclosed before download) streaming responses via
  [WebLLM](https://github.com/mlc-ai/web-llm)/WebGPU. The one page here with **no CPU fallback** — a
  browser without WebGPU gets an explicit message instead of a broken demo, and a browser with the API
  but no real adapter (checked in the sandbox this was built in, which has exactly that setup) gets
  WebLLM's own clear "no compatible GPU" error, not a hang or a silent failure. **Caveat this page
  doesn't share with pages 1/2: the actual chat generation was not verified before shipping** — the
  build environment has no real GPU adapter to test against, only the load-failure path could be
  exercised. Needs a real WebGPU machine to confirm generation, streaming, and the stop/reset controls
  actually work before calling it done the way the other two pages are. **Update:** tested live on an
  iPhone 13 (Safari) — the 3B default loaded but crashed the tab shortly after generation started,
  matching a documented WebLLM/mobile-Safari failure pattern (loading fits in memory; generation's
  extra KV-cache/activation buffers don't). Consistent with community reports elsewhere: WebLLM is
  workable on modern desktops, unreliable to broken on phones even at the 1-3B tier.
- [Speech to text](https://nlade-core.github.io/pages-lab-ai/speech-to-text/) — Whisper-tiny.en,
  upload an audio file or record from your microphone. Runs full fp32 weights (~152MB): **every**
  quantized variant of this repo's decoder (q8, uint8, fp16 — int8 doesn't even exist at the expected
  path) failed to create an ONNX Runtime Web session in a real browser, each with a different
  graph-level error, despite loading fine in a Node-based test first. That Node test was the wrong
  signal — Node uses a different ORT backend than the browser's WASM one, so "works in Node" didn't
  transfer. Verified directly in headless Chrome afterward: correct transcription on a synthesized
  test clip, and the microphone-record-to-blob-to-transcribe flow working end to end.

## Considered, not built

- **Zero-shot / open-vocabulary classification (CLIP-style)** — user types their own candidate labels
  instead of being stuck with ImageNet's fixed, dated 1000-class vocabulary (no "person," no
  "screenshot," lots of oddly narrow categories). Mechanically it's page 1's image encoder + page 2's
  embed-and-rank-by-cosine-similarity, recombined — CLIP itself just outputs a 512-number embedding
  vector per image or per text string, no classification head; the ranked-percentage output is
  assembled downstream the same way page 2 already does it. Looked into `Xenova/mobileclip_s0`
  (Apple's on-device-optimized CLIP variant, not the standard 606MB/154MB ViT-B/32): its own
  transformers.js config forces the vision tower to fp32 regardless of requested dtype, which reads as
  the maintainers already knowing the quantized vision tower isn't trustworthy — same failure class as
  MobileNetV2's, caught by them instead of by us this time. Realistic footprint is fp32 vision (~45.5MB)
  + quantized text (~42.8MB) ≈ 88MB combined — heavier than pages 1/2, still well short of
  WebLLM/diffusion territory, and doesn't need WebGPU. Also needs UX work beyond the model swap: CLIP's
  zero-shot accuracy is sensitive to label phrasing (`"a photo of a dog"` scores meaningfully better
  than bare `"dog"`), so a raw text box would under-sell it. Still worth building — the natural pick
  for the next page.
- **Stable Diffusion** via ONNX Runtime Web — checked real component sizes (`aislamov`'s browser-ready
  ONNX conversions): base SD 2.1 (needs 25-50 diffusion steps/image) is text encoder 681MB + UNet
  1.75GB + VAE ~236MB ≈ 2.67GB total. An LCM-distilled variant (needs only 4-8 steps) is ≈ 2.2GB —
  barely smaller. Correction to an earlier assumption: distillation buys generation *speed* (5-10x
  fewer steps), not a smaller download — same ~2.2-2.7GB weight class as WebLLM's 3B tier either way,
  and diffusion is more compute-hungry per generation than token-by-token chat decoding. Given the
  chat page's real iPhone 13 crash, expect this to be unusable on any phone and dicey on modest
  desktop GPUs. Same WebGPU-only, no-CPU-fallback shape as chat, just heavier.
- **MobileNetV4-Small swap-in** for the current classifier — real but modest gain (73.8% vs 71.8%
  top-1 on ImageNet, at *fewer* MACs than V2), and its ONNX export hasn't been verified the way V2's
  was found broken. Low priority: same capability, not a new one.
