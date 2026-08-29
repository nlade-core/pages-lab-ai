# pages-lab-ai

In-browser AI demo, zero backend. Sequel to [pages-lab](https://github.com/nlade-core/pages-lab) and
[pages-pyodide](https://github.com/nlade-core/pages-pyodide) — JS-native this time (transformers.js /
ONNX Runtime Web), not Pyodide, since real model inference needs GPU access Pyodide can't give it.

Scope still being decided. Candidates on the table:
- small on-device image classifier or embedding/semantic-search model (tens of MB, WASM/WebGL fallback,
  no hard WebGPU requirement)
- WebLLM chat demo (Phi-3-mini / TinyLlama class) — flashier, but hundreds of MB to ~2GB and needs
  WebGPU, so it's Chrome/Edge-on-decent-hardware only
- distilled Stable Diffusion via ONNX Runtime Web — same weight/WebGPU caveats as WebLLM

Status: repo scaffolded, build not started.
