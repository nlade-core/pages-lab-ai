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
- [Text to speech](https://nlade-core.github.io/pages-lab-ai/text-to-speech/) — Kokoro (82M params),
  type text and pick a voice from ~28 options across languages/accents. Mirror image of the
  speech-to-text page. Runs the int8-quantized export (~92MB) directly — unlike Whisper's, this one
  checked out fine: verified by round-tripping generated audio back through the already-verified
  Whisper pipeline and confirming the transcript matched the input text exactly. `device: 'wasm'`
  explicitly, so it stays in the same runs-everywhere lane as pages 1/2/4, not chat/diffusion's
  WebGPU-only one. **Real bug found live, on the user's own Mac:** loads fine in Safari, but generating
  speech spikes CPU/memory and looks like a hang (rest of the tab stays responsive — it isn't a real
  deadlock, WebKit's JIT is just looping) while the identical page works fine in Chrome on the same
  machine. Root cause: [microsoft/onnxruntime#26827](https://github.com/microsoft/onnxruntime/issues/26827)
  — a pathological loop in WebKit's own JIT stack allocator, triggered by ONNX Runtime Web's JSEP mode
  on WebKit 26, unrelated to this page's code (the report's own repro used a completely different
  model). Not deterministic — didn't reproduce in Playwright's WebKit during investigation — so the
  page shows a soft warning to Safari visitors (detected via user-agent sniffing that correctly
  excludes Chromium, which also has "Safari" in its UA string) rather than blocking use outright.
- [Chrome's built-in AI](https://nlade-core.github.io/pages-lab-ai/chrome-ai/) — the odd one out:
  every other page brings its own model, this one asks the browser instead. Live capability check
  (Summarizer, Prompt API, Writer, Rewriter, Proofreader, Translator, Language Detector — checked via
  each API's real `.availability()`, not assumed), plus working Summarizer and Prompt API demos.
  Chrome desktop only. Initially found and enabled the real, current flag (`#prompt-api`, not
  `optimization-guide-on-device-model`/`prompt-api-for-gemini-nano` as older docs said — found by
  grepping the actual `chrome://flags` page rather than trusting documentation that had moved on) —
  but on checking back later, the flag was sitting at `Default` (not the `Enabled` it had been set
  to) and the API still worked — meaning Prompt API has since graduated to on-by-default alongside
  Summarizer/Translator/Language Detector. Writer/Rewriter/Proofreader are the only ones still
  needing manual enabling.
  **Verification note, a new category:** testing this in Playwright's Chromium is fundamentally
  limited in a way none of the other pages are — Gemini Nano itself is a Google-proprietary asset that
  ships only with branded Google Chrome, not open-source Chromium. Playwright's browser has the full
  API surface (confirmed: Summarizer/Prompt/Translator/Language Detector all present, correctly report
  `downloadable`) but calling them returns an honest built-in stub — *"Model not available in
  Chromium, this API is just echoing back the input"* — rather than real inference. Everything about
  this page's code, UI, and error handling is verified; the actual model output can only be confirmed
  on real Google Chrome (which the user separately did, live, via DevTools console, before this page
  existed). **Update: confirmed working.** Multimodal chat (text + image + audio attachments) was
  tested on the user's real Chrome and Gemini Nano correctly processed both the attached image and
  audio alongside the text — the first fully-confirmed real inference result this page has gotten,
  not just Chromium's stub.
  **Update:** added live Translator and Language Detector demos (the other two stable APIs), a
  side-by-side timing comparison across all four, and two concurrency tests (same-API and cross-API)
  to check whether calls actually run in parallel or queue behind each other. Caught and fixed two
  real methodological bugs while building the concurrency test specifically: raw start/end interval
  overlap can't detect serialization at all (`Promise.all` dispatches every call at the same instant
  regardless of what happens internally), and comparing only an aggregate total against max/sum of
  solo baselines masks per-API differences — a per-API baseline comparison is the only one that
  actually distinguishes true independence from partial contention. A third bug — `Promise.all(arr.
  map(...))` calls each function in a fixed array order, so whichever API is listed first always wins
  a shared-queue race and looks falsely independent — was fixed by shuffling the call order each run
  and tracking whether the "independent" one stays the same or rotates across repeated runs. **Real
  findings, confirmed on real Chrome across multiple runs, not assumed:** Prompt API and Summarizer
  share one exclusive execution resource (very likely the same underlying Gemini Nano model) — only
  one can run at a time, confirmed three separate times by matching arithmetic (the delayed API's
  concurrent finish time minus the winner's lands almost exactly on the delayed API's own solo
  baseline). Translator and Language Detector are genuinely separate, lightweight, non-generative
  models, unaffected by anything else running alongside them, in every test. Practical implication:
  routing requests to a "smaller model to save time" only pays off for Translator/Language Detector,
  and even then it's really about not blocking an in-flight Prompt API/Summarizer call rather than raw
  speed, since Prompt API can already perform translation/language-detection itself via prompting.
- [Code chat](https://nlade-core.github.io/pages-lab-ai/code-chat/) — a chatbot for *this page's own
  source*: fetches its own deployed HTML/CSS/JS once via a plain same-origin `fetch(location.href)`,
  seeds it whole into Gemini Nano's `initialPrompts` (a system-prompt mechanism not used anywhere else
  in this repo), then answers questions grounded in that source — no retrieval, no second model,
  deliberately an MVP. A richer version (retrieval over the *whole* repo via page 2's embeddings,
  chunked to fit MiniLM's real 256-token effective limit) was designed in detail but deliberately cut
  for v1. **Real finding while building:** hit a `QuotaExceededError` ("The input is too large") in
  testing — traced to Playwright's Chromium reporting a stub `contextWindow` of only 1,000 tokens,
  dramatically smaller than real Gemini Nano's documented ~9,216. This page's source (~11.8KB, an
  estimated 3,500-4,000 tokens) should comfortably fit the real window with room for conversation, but
  that's an estimate, not a confirmed result — **whether the seeded chat actually works, rather than
  hitting the same error for real, is unverified until tested on real Chrome.**
- [Pyodide notebook](https://nlade-core.github.io/pages-lab-ai/pyodide-nb/) — a minimal Jupyter-style
  notebook: add cells, run Python in each, and every cell shares the same live interpreter (a variable
  set in one cell is still there in the next). Runs bare Pyodide only (~11MB, no OpenCV/numpy/pillow —
  verified directly via the real file sizes, smaller than pages-pyodide's footprint since this page
  doesn't need those packages). Built and verified standalone, deliberately, before wiring it up as a
  code-execution tool a chatbot could call: confirmed shared state works across cells, and — the part
  that actually matters for a future tool-use loop — confirmed the interpreter keeps working correctly
  in later cells even after an earlier one throws, rather than dying on the first mistake. Now also
  has a Gemini Nano copilot sidebar — a sticky side panel (stacks below on narrow viewports) reusing
  `code-chat`/`chrome-ai`'s exact chat pipeline with a Python-debugging system prompt, for pasting
  errors or questions manually. Not the automatic tool-use loop (the model doesn't run code itself yet)
  — just a faster way to ask for help than switching pages. Real-use finding, worth knowing before
  building on this: tested for actual Python-debugging help on real Chrome — "not that brilliant,"
  consistent with Gemini Nano's own documented small-model/factual-accuracy limits. Code debugging
  specifically isn't a task this model is optimized for.
- [Thinking chat](https://nlade-core.github.io/pages-lab-ai/thinking-chat/) — same Gemini Nano chat,
  with a "thinking" toggle. Chrome's Prompt API has no native reasoning mode (that's an Android ML
  Kit-only feature, confirmed by checking — `enableThinking`/`thoughtProcess` don't exist on the web
  API); this fakes it with a system prompt plus `responseConstraint` (structured JSON output,
  `{reasoning, answer}`), with the reasoning hidden behind a native `<details>` disclosure arrow by
  default. Real constraint: structured output needs the full response before it can be parsed against
  the schema, so "thinking on" doesn't stream token-by-token the way "thinking off" still does — an
  honest tradeoff, not hidden from the visitor. Verified: `responseConstraint` doesn't throw even
  against Chromium's non-compliant stub output, the JSON-parse fallback handles a non-JSON response
  cleanly without crashing, and the native disclosure toggle genuinely hides/reveals on click.
- [Code agent](https://nlade-core.github.io/pages-lab-ai/code-agent/) — the tool-use loop `pyodide-nb`
  and `thinking-chat` were both built toward: Gemini Nano decides, per turn, whether to run real Python
  or answer directly. Chrome's Prompt API has no native tool/function-calling primitive, so this is the
  manual version — every turn is constrained via `responseConstraint` to a fixed
  `{action, code, answer}` shape; `action: "run_python"` turns are actually executed by `pyodide-nb`'s
  verified `runCode()` helper (real Pyodide, not a simulation), the real stdout/result/error is fed back
  in as the next turn, and the loop repeats (capped at 4 tool calls) until the model emits
  `action: "final_answer"`. Loading the Pyodide tool (~11MB) is a separate opt-in click from starting
  the chat, so plain conversation works even before it's loaded — the model is told the tool's
  unavailable and recovers by answering without it, rather than the page throwing. Verified end to end
  with Playwright by stubbing `LanguageModel` deterministically (real Chromium has no Prompt API at
  all): a genuine `run_python("2 + 2")` call round-trips through real Pyodide, returns `4`, and the
  fed-back result reaches a correctly-rendered final answer; separately confirmed the non-JSON fallback
  (mirroring Chromium's own non-compliant stub), the tool-unavailable recovery path, and the
  max-tool-calls cap all behave correctly rather than crashing or hanging. Actual answer quality/real
  Gemini Nano tool-use judgment is unconfirmed on real Chrome, same standing caveat as every other Nano
  feature here — and given `pyodide-nb`'s copilot and `thinking-chat` both landed on "functional but not
  brilliant," temper expectations for how well the model actually *decides* when to reach for the tool,
  even though the execution step itself is reliably correct regardless.
- [Chat threads](https://nlade-core.github.io/pages-lab-ai/chat-threads/) — a Gemini Nano chat that
  remembers more than one conversation, saved to `localStorage`, listed in a sidebar. The key design
  constraint: nothing is loaded into the model just from opening the page or seeing the sidebar —
  `LanguageModel.create()` is never called at boot, confirmed directly (0 calls until a real send or
  click). Clicking a saved thread renders its old messages instantly (just redrawing saved text, free),
  then separately replays them into a brand-new session via `initialPrompts` — the only moment this page
  ever spends real context-window budget restoring history, and only for the one thread actually opened,
  never the others sitting untouched in storage. Continuing that thread appends new messages and
  persists them back; switching threads calls `session.destroy()` on the outgoing session first, so
  live model state doesn't pile up. Verified end to end with Playwright (stubbed `LanguageModel`,
  tracking real call counts): confirmed zero session creation at boot and after a reload, confirmed the
  exact prior messages are what gets sent as `initialPrompts` when a thread is opened, confirmed
  messages render before the replay call even resolves, and confirmed `destroy()` fires on every
  thread switch. Companion to
  [pages-lab's storage experiment](https://nlade-core.github.io/pages-lab/07-storage-limits/), applied
  to a real chatbot instead of a toy comparison. Same standing caveat as every Nano feature here:
  storage is purely local to one browser on one device — no cross-device sync, no login, nothing to
  sync through.
- [Zero-shot classification](https://nlade-core.github.io/pages-lab-ai/clip/) — type your own candidate
  labels instead of being stuck with ImageNet's fixed, dated 1000-class vocabulary. Mechanically page
  1's image pipeline + page 2's embed-and-rank-by-cosine-similarity, recombined — CLIP (`Xenova/mobileclip_s0`)
  outputs a 512-number embedding per image or per text string, no classification head of its own. Real
  bug caught building this, correcting the earlier "parked" research note: the quantized vision export
  isn't merely unavailable, it's **measurably wrong** — confirmed directly on a real test photo, a black
  Labrador (the same photo that caught page 1's MobileNetV2 quantization bug): fp32 vision correctly
  ranks "a dog" highest (23.7%, clearly separated); the q8/uint8 quantized vision export flips the top
  result to "a screenshot of computer code" instead. Shipped fp32 vision (~43.4MB, real measured size)
  + quantized text (~40.8MB) ≈ 85MB total — quantizing the text tower is safe, same "damages conv
  layers, not attention layers" pattern already seen with MiniLM. A second, separate real bug caught
  before ever writing browser code (found testing the model in Node first): CLIP's text tower expects
  inputs padded to its fixed 77-token training context length, not padded to the batch's own longest
  line like a typical encoder — the naive approach throws a real ONNX Runtime broadcast error
  (`axis == 1 || axis == largest was false`) instead of running. Also ships the label-phrasing UX this
  needs beyond a plain model swap: an "auto-phrase" toggle wraps bare words as `"a photo of {label}"`
  (CLIP's zero-shot accuracy is genuinely sensitive to this — verified directly, not assumed) with a
  live preview of exactly what text gets sent to the model. Verified end to end in a real browser
  against the actual downloaded weights (not stubbed — this is an ordinary transformers.js model, fully
  functional in plain Chromium): real image encoding, real label comparison, correct top-ranked result
  on a real photo, and the reset-to-a-new-photo flow all confirmed via Playwright.

- [Webcam captioning](https://nlade-core.github.io/pages-lab-ai/webcam-nano/) — point your camera at
  something, Gemini Nano describes each frame. Not real-time video understanding: the Prompt API only
  accepts single still images, not a video stream, so this grabs one frame, waits for the model to
  finish describing it, then grabs the next — a caption every second or two, not literal live video.
  Each frame is its own stateless session (created, prompted, destroyed) rather than one growing
  conversation, deliberately: feeding image after image into a single session's history would eventually
  burn through Nano's ~9K token context and hit `QuotaExceededError`, and there's no reason to pay that
  cost when each frame's description doesn't depend on the last one anyway. Reuses page 1's webcam
  capture/downscale-to-canvas code and `chrome-ai`'s multimodal image-input session pattern almost
  verbatim — no new mechanics, pure recombination, same as `clip`. Verified end to end with Playwright,
  stubbing `LanguageModel` deterministically (real Chromium has no Prompt API): zero session creation at
  load, one `create()`/`destroy()` pair per completed frame with `expectedInputs` correctly declaring
  image support and a seeded system prompt, the rendered caption matches the (stubbed) model output, and
  the capture loop provably stops for good after Stop is clicked rather than continuing in the
  background. Real Gemini Nano output quality (does it actually narrate the scene usefully, and how long
  a real image-inference round trip takes) is unconfirmed until tested on real Chrome, same standing
  caveat as every other Nano feature in this repo. **Camera picker, added later**: `getUserMedia` doesn't
  care what physical device backs a camera, so anything the OS registers as one — a second built-in
  camera, an iPhone via macOS Continuity Camera, a GoPro in USB webcam mode — shows up here with zero
  code changes beyond letting you choose it. The dropdown only appears once permission's granted (device
  *labels* are blocked pre-permission, a browser privacy protection) and only when there's more than one
  camera to pick between; switching mid-analysis stops the old stream and starts the new one without
  interrupting the running capture loop, which reads the `<video>` element rather than the stream object
  directly. Verified with two fake devices: labels render correctly, the active device is pre-selected,
  switching requests the exact `deviceId` chosen and the analysis loop keeps producing frames afterward
  uninterrupted, and the picker stays hidden entirely when only one camera is available. **Live device
  detection, added right after**: the picker only ever reflected what was available at the moment Start
  was clicked, so a camera connecting mid-session (an iPhone joining as a Continuity Camera after the
  page was already running) silently never appeared without a restart. Fixed by listening for the
  browser's own `devicechange` event and refreshing the list live, gated on a session actually being
  active so it doesn't do anything while stopped. Verified: an iPhone-labeled device injected mid-session
  appears in the picker with no restart required, both cameras remain listed (not just the new one), and
  a `devicechange` firing while stopped correctly does nothing.

- [Video captioning](https://nlade-core.github.io/pages-lab-ai/video-nano/) — upload a video clip,
  Gemini Nano describes one frame per second and builds a timestamped transcript. `webcam-nano`'s
  sibling: same stateless-session-per-frame design, same downscale-to-JPEG-blob capture helper, just a
  seekable uploaded file (`video.currentTime` + the `seeked` event) instead of a live camera stream as
  the frame source — no CORS concerns since it's a local `Blob` URL, not a cross-origin fetch. A 90-second
  clip means 90 separate sequential model calls, not parallel ones, same one-shared-model discipline as
  every other Nano feature here. A failed frame (seek timeout, model error) gets its own error row and
  the run continues rather than aborting. Verified end to end with Playwright against a **real** decoded
  4.5-second test clip (not stubbed video, only `LanguageModel` is stubbed): correctly computes 5
  timestamps for a 4.5s clip at 1fps, exactly one `create()`/`destroy()` pair per frame in order
  (0:00-0:04), transcript rows match, and the reset flow clears state correctly. Same standing caveat as
  every Nano page: real output quality/per-frame latency on an actual video is unconfirmed until tested
  on real Chrome. Also handles files Chrome can't decode (reliably just MP4/H.264 and WebM — `.mov`/`.mkv`/
  `.avi` are hit-or-miss to unsupported) with a clear error instead of hanging on a `loadedmetadata` event
  that never fires. **Both the system prompt and the per-frame question are user-editable**, pre-filled
  with the working defaults — since every frame is already a fresh stateless session, there's no state to
  migrate when they change. An emptied field falls back to the real default rather than sending a blank
  prompt. Verified: the fields load with the true defaults, a custom system prompt and question both
  actually reach the (stubbed) model rather than the hardcoded strings, and clearing either field falls
  back correctly.
- [Wikipedia explorer](https://nlade-core.github.io/pages-lab-ai/wiki-explore/) — a two-pane reading
  experience: the actual Wikipedia article (rendered from its own plain-text extract, not fetched a
  second time in a different format) on the left, a Gemini Nano copilot sidebar on the right. The
  interesting part: Gemini Nano has no native tool-calling, so retrieval is hand-rolled. The model is
  primed at page load with just the article's summary and its section *titles* (confirmed negligible —
  a few hundred tokens for a real article), not the full text of any section. If a question needs more
  than the summary, the model is instructed to reply with exactly `NEED_SECTION: <title>`; the app
  catches that, looks up the real section text (already fetched, no new network call), injects it, and
  asks a second time — only that final answer is ever shown, confirmed the marker text itself never
  reaches the visible chat. A visible "Looking into the {title} section…" note explains the extra
  wait, which is real and additive: Prompt API can't parallelize with itself (see chrome-ai above), so
  needing a section roughly doubles whatever a normal reply already costs. Deliberately non-streaming
  (`prompt()`, not `promptStreaming()`) for v1 — a `NEED_SECTION` marker is indistinguishable from the
  start of a real answer until enough of it has arrived, and rendering it live risks the raw control
  text flashing on screen before the app catches it; real streaming is a follow-up once the retrieval
  logic itself is proven, not solved at the same time. Chosen over three other researched "info
  exploration" directions: Wikidata (genuinely interesting relationship exploration — confirmed via
  SPARQL that the Eiffel Tower's architect, Stephen Sauvestre, also designed a chocolate factory
  nicknamed "the Cathedral building," a real discovery no article text would surface — parked for
  later), Project Gutenberg (full public-domain books via Gutendex, parked as too big a stress-test for
  a first pass), and Openverse (openly-licensed media search, deferred since images/media are
  explicitly a later priority than text). Also visibly discloses the CC BY-SA 4.0 attribution this
  fuller display of an article needs, per Wikipedia's own reuse guidance. Verified with Playwright:
  real headings/intro render with citation-only tail sections excluded, the system prompt confirmed to
  contain titles but NOT full section content, the two-call retrieval sequence confirmed via the
  actual `prompt()` arguments, a hallucinated section title handled gracefully, and — a real bug
  caught after shipping — the chat log itself couldn't scroll (CSS Grid's implicit row was auto-sizing
  to content instead of the container's height; fixed with `grid-template-rows: minmax(0, 1fr)`).

## Considered, not built

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
