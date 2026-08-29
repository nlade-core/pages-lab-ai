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

## Considered, not built

- **Semantic search / embeddings** — type a sentence, embed it client-side, rank against a corpus by
  cosine similarity. Doesn't need camera/mic permissions; reads as "AI" more distinctly than a
  classifier does, since it does something classical CV categorically can't (work on meaning, not
  pixels).
- **Zero-shot / open-vocabulary classification (CLIP-style)** — user types their own candidate labels
  instead of being stuck with ImageNet's fixed, dated 1000-class vocabulary (no "person," no
  "screenshot," lots of oddly narrow categories). A materially different capability from the current
  classifier, not just a bigger/newer model doing the same trick.
- **WebLLM chat demo** (Phi-3-mini / TinyLlama class) — flashier, but hundreds of MB to ~2GB and needs
  WebGPU, so it only works on Chrome/Edge with decent hardware.
- **Distilled Stable Diffusion** via ONNX Runtime Web — same weight/WebGPU caveats as WebLLM.
- **MobileNetV4-Small swap-in** for the current classifier — real but modest gain (73.8% vs 71.8%
  top-1 on ImageNet, at *fewer* MACs than V2), and its ONNX export hasn't been verified the way V2's
  was found broken. Low priority: same capability, not a new one.
