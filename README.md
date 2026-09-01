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
  second time in a different format) on the left, a Gemini Nano copilot sidebar on the right, with a
  draggable splitter between them (clamped to sane minimums, persisted per-visitor). The article is
  parsed into a real parent/child tree, not a flat list with a level number bolted on — every node
  carries its own char count and a rolled-up total across its whole subtree, confirmed against the real
  live article to reach genuine 3-deep nesting (`Design > Floors > 1st floor`). The starter chat message
  shows a short intro with the summary, the (nested, not flattened) section list, and a set of Wikidata
  facts (below) each behind their own collapsed dropdown.

  The interesting part is the retrieval itself, hand-rolled since Gemini Nano has no native tool-calling.
  It's staged, escalating only as far as a question actually needs: **(0)** the question goes in with the
  summary, known facts, AND the section title tree (titles only, no content or char counts — those are
  ranking-only, see below) already in context. Section titles were originally left out of the system
  prompt entirely, reasoned about purely as retrieval cost; reconsidered on request — a model aware of the
  full topic map from turn one can reference or guide a conversation, not just react to one question, and
  a bare title list costs the same negligible ~200-300 tokens already measured cheap elsewhere. Most
  questions still stop at this stage. **(1)** if the model replies with exactly
  `NEED_MORE_INFO`, a second call shows it the *entire* flattened section tree — full paths and a rough
  char-count size hint per node, titles and sizes only, still no content — and asks for its top 3 picks
  in priority order (`RANK: <first> | <second> | <third>`). **(2)** those ranked sections are injected
  one at a time, most likely first (each with its own full subtree text and heading path, e.g.
  `Section path: Design > Materials`), checking after each whether that's now enough to answer and
  stopping the moment it is — confirmed via a nested-subsection case that a rank-1 hit never touches
  rank 2 at all. If the top-ranked pick isn't enough, the *last* ranked hop drops the `NEED_MORE_INFO`
  option entirely and forces a real answer from whatever's been gathered so far, so this can never dead-
  end without a response; an unmatched or garbled rank list degrades the same way, straight to one forced
  best-effort call. Deliberately non-streaming (`prompt()`, not `promptStreaming()`) throughout — a
  marker like `NEED_MORE_INFO` or `RANK:` is indistinguishable from the start of a real answer until
  enough of it has arrived, and rendering it live risks raw control text flashing on screen; real
  streaming is a follow-up once this logic is proven, not solved at the same time. Each escalation is
  surfaced with a visible note ("checking which sections might help…", "Checking 'Design > Materials'
  (1/2)…") rather than a silent wait, and each hop is real and additive cost — Prompt API can't
  parallelize with itself (see chrome-ai above), so a fully escalated question costs roughly 3-5x a
  plain one.

  Companion structured facts now come from Wikidata too — and, since being rebuilt, this works for *any*
  Wikipedia article, not just this one demo. An earlier version hand-curated a 7-property allowlist
  (height, architect, materials...) tuned specifically for a landmark; confirmed live that it was
  completely useless off-topic — every one of the 7 was missing on Marie Curie's Wikidata item. The
  generalized version keeps whatever properties an item actually has, excluding only what's caught by two
  fully generic rules: (1) drop anything typed `external-id`, `url`, or `commonsMedia` (measured live: this
  alone cuts a rich item's ~180 properties to ~40, since the majority are cross-reference IDs to other
  databases); (2) drop a ~165-property blocklist Wikidata *itself* formally classifies as being about the
  Wikidata/Wikimedia entry, or the subject's own online/social presence, rather than the real-world subject
  — queried live via SPARQL against four real Wikidata classes, not hand-guessed, catching things rule (1)
  can't (like `maintained by WikiProject`, `hashtag`, `social media followers`).
  Folded directly into the system prompt alongside the summary — a handful of facts is only a couple
  hundred tokens, negligible against Nano's context window, so there's no size problem to justify a
  `NEED_MORE_INFO`-style escalation the way section text gets one. Label resolution (an item-type value's
  real form is a pointer to *another* Wikidata item, e.g. architect → `Q778243`, not "Stephen Sauvestre")
  tries 9 languages in order — `en, mul, de, fr, es, ru, zh, ar, ja` — reasoned out for maximal
  non-overlapping coverage (each pick covers genuinely different ground — script, geography, community —
  than the ones before it, rather than just being another big language), not picked by raw size alone;
  `mul` goes first regardless of stats since it's Wikidata's own tag for names that were never going to
  get a real per-language translation in the first place. Measured directly: requesting all 9 costs
  nothing meaningful (~27KB for a real 50-id batch, on a fetch that only happens once per page load).

  Several real bugs surfaced by testing genuinely different articles (Eiffel Tower, Monster truck,
  Sandwich), not assumed away: two more raw-value shapes (monolingualtext, globe-coordinate) hit the exact
  same `[object Object]` bug a Quantity value did earlier; the formally-sourced blocklist turned out to be
  incomplete (missing "native label" and "different from," both re-added once the gap was confirmed, not
  silently dropped); and one property's value was an EntitySchema reference (`E204`), not a real item —
  treating it as a Q-id to resolve broke the *entire* batched labels call, the same failure class as an
  earlier dimensionless-unit-string bug, just via a different kind of non-item id slipping through a now
  more generic code path. Height still deliberately prefers Wikidata's `rank: preferred` statement over
  two other conflicting values, and inception/construction dates are still excluded — the real item
  carries two conflicting dates with no preferred rank and only an ambiguous qualifier distinguishing them,
  so surfacing both unlabeled would be actively misleading, not just noisy. Deciding which of an arbitrary
  article's remaining properties are *interesting* (versus merely not-excluded) is left for later — this
  generalizes correctly, but doesn't yet rank or curate beyond the two exclusion rules.

  **Documented, not built:** three more noise properties still slip through every rule above — `described
  by source`, `public domain date`, `offers view on`. Unlike the four classes already excluded, `described
  by source`'s own Wikidata classification ("property to indicate a source") can't be blocklisted wholesale
  — it also contains `author`, `publisher`, and `publication date`, genuinely useful top-level facts on a
  book's or film's own Wikidata item, so removing the whole class would create a new gap to fix this one.
  These three would need individual hand-adding instead, same as the two exceptions already in the
  blocklist. Also noted but not acted on: the UI's starter-message dropdown order (currently Summary →
  Sections → Known facts) arguably reads better as Summary → Known facts → Sections, grouping the two
  "quick answer" sources together and leaving the "go deeper" option last.

  Chosen over two other researched "info exploration" directions, both still parked: Project Gutenberg
  (full public-domain books via Gutendex, parked as too big a stress-test for a first pass) and Openverse
  (openly-licensed media search, deferred since images/media are explicitly a later priority than text).
  Wikidata's own deeper draw — relationship exploration, not just fact lookup (confirmed via SPARQL that
  the Eiffel Tower's architect, Stephen Sauvestre, also designed a chocolate factory nicknamed "the
  Cathedral building," a real discovery no article text would surface) — remains parked; what shipped
  here is the narrower fact-lookup use, not that. Also visibly discloses the CC BY-SA 4.0 attribution this
  fuller display of an article needs, per Wikipedia's own reuse guidance. Verified with Playwright against
  both a stub and the real live article/Wikidata API: real headings render at their true nesting depth
  with citation-only tail sections excluded, the system prompt confirmed to hold the summary and curated
  facts but no section content, the full ranked multi-hop sequence confirmed via the actual `prompt()`
  arguments (including that a satisfied rank-1 genuinely skips rank 2), the forced-final-answer and
  no-match fallbacks both confirmed to never dead-end, the resizable split confirmed to clamp at both ends
  and persist across a reload, a Wikidata failure confirmed to never block the article or chat from
  working, and — a real bug caught after the first ship — the chat log itself couldn't scroll (CSS Grid's
  implicit row was auto-sizing to content instead of the container's height; fixed with
  `grid-template-rows: minmax(0, 1fr)`).

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
- **wiki-explore: full article references/citations** — skip. Wrong data source (`explaintext=1`, which
  the whole tree-parsing pipeline is built around, strips citations entirely; getting them means a
  different HTML/wikitext parsing pipeline, not an addition to this one) and wrong fit for what this page
  does (references are about *sourcing*, this page is built for *comprehension and fact lookup* — a
  bibliography entry helps neither a reader's understanding nor the model's ability to answer a question).
- **wiki-explore: full in-context photos with captions, throughout every section** — skip, on cost, not
  value. Genuinely would improve the reading experience, but properly positioning captioned images inside
  their correct section needs the full/mobile HTML endpoint, a structurally different data source than
  the plain-text extract this page's tree parser depends on — a real re-architecture for a nice-to-have,
  not a core need.
- **wiki-explore: a single lead image** — the one image-related item actually worth doing. Different case
  from full in-context photos: `chrome-chat`'s `/wiki image` already solved exactly this (media-list
  endpoint, filtered to Commons-hosted for licensing safety, confirmed live against a real non-Commons
  case). One hero image at the top of the article pane, reusing already-proven code, gets most of the
  "this feels like a real article" benefit for a fraction of the cost of full illustration.
- **wiki-explore: infobox data as its own feature** — moot, already solved differently: the Known Facts
  feature (Wikidata-sourced) already surfaces the infobox's actual content (height, architect, materials,
  coordinates); no separate infobox-scraping effort needed.
- **wiki-explore: an embedded map from the coordinates already in Known Facts** — a genuinely interesting
  idea, but a new capability (embedding a map widget), not something to pull from the Wikipedia API itself
  — worth treating as its own separate feature decision later, not bundled with this list.
- **wiki-explore: a security/quality pass**, done, nothing critical — full findings below, for the next
  session to act on rather than re-derive:
  - Two quick wins, already fully reasoned through: drop the "Summary" dropdown from the chat's starter
    message (pure duplication of the main reading pane now that its paragraphs render correctly); hand-add
    the three still-slipping-through Wikidata noise properties (`described by source`/`public domain
    date`/`offers view on`) individually to the blocklist, not via their shared class (which also contains
    genuinely useful facts like `author`/`publisher` for other topics).
  - A single lead image is recommended and cheap to add — `chrome-chat`'s `/wiki image` already solved the
    fetch + Commons-licensing-safety check; this would be a port, not new work.
  - Quality items, low urgency: `fetchArticle`/`resolveWikidataQid` throw a raw, unfriendly error if a
    title doesn't resolve (unreachable today since the title is hardcoded, but relevant the moment
    page-choice lands); `buildRankingPrompt` includes the *entire* flattened section list uncapped, fine
    for this article's size but could get unwieldy on a much bigger/deeper one; `fetchWikidataFacts`'s
    final loop accesses `propEntities[pid]` with no existence check.
  - Security, both accepted/low-severity rather than fixed: a visitor's raw question is concatenated
    directly into instruction-bearing prompt strings with no delimiter hardening (real prompt-injection
    surface, but blast radius is just "the model says something odd in that visitor's own chat" — no
    tool-use or page-mutation capability exists downstream); the pinned `marked` CDN import has no
    Subresource Integrity hash (ES module `import` can't carry SRI the way `<script src>` can — same
    accepted trust model as every other page in this family, not unique to this one). Escaping itself was
    checked and found consistent and correct everywhere it matters.
  - The bigger, standing next step behind all of this: page-choice / multiple articles — the actual reason
    today's full retrieval + Wikidata-fact rebuild happened. The data model was deliberately kept free of
    hardcoded state specifically so this doesn't mean reworking the retrieval logic, just adding a way to
    pick/hold more than one article.
