// Benchmark the browser's built-in model (Prompt API) on prompts.json.
// One fresh session per item. Each result is saved to localStorage as it finishes;
// a re-run resumes, and refuses to mix in results from another prompt set, browser or settings.
import { score } from './score.js?v=1';

const STORE_KEY = 'pages-lab-ai:bench';
const ITEM_TIMEOUT_MS = 180000;
const LANG_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

const $ = (id) => document.getElementById(id);
const ui = { run: $('run-btn'), stop: $('stop-btn'), dl: $('dl-btn'), clear: $('clear-btn'), rows: $('rows'), note: $('note'), guard: $('guard'), progress: $('progress') };

function status(kind, model, detail) { $('dot').className = 'dot ' + kind; $('model').textContent = model; $('detail').textContent = detail || ''; }
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmtMs = (ms) => ms == null ? '–' : ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(2) + ' s';
const fmtEta = (ms) => ms == null ? '–' : Math.floor(ms / 60000) + 'm' + String(Math.round(ms / 1000) % 60).padStart(2, '0') + 's';

// ---------------------------------------------------------------- environment

async function detectBrowser() {
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand);
  const isEdge = brands.includes('Microsoft Edge') || /\bEdg\//.test(navigator.userAgent);
  const isChrome = !isEdge && brands.includes('Google Chrome');
  const name = isEdge ? 'Edge' : isChrome ? 'Chrome' : 'Other';
  let version = null;
  try {
    const hi = await navigator.userAgentData?.getHighEntropyValues(['fullVersionList']);
    const want = isEdge ? 'Microsoft Edge' : isChrome ? 'Google Chrome' : 'Chromium';
    version = hi?.fullVersionList?.find((b) => b.brand === want)?.version ?? null;
  } catch { /* fall through to UA */ }
  version ??= (navigator.userAgent.match(isEdge ? /Edg\/([\d.]+)/ : /Chrome\/([\d.]+)/) || [])[1] ?? null;
  const model = isEdge ? 'Phi-4-mini' : isChrome ? 'Gemini Nano' : 'Built-in model';
  return { name, version, model_label: model + ' (' + name + ')' };
}

async function sha256Hex(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- storage

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}
function saveStore(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); }
  catch (e) { ui.note.textContent = 'Could not save to localStorage (' + e.message + '). Download before leaving.'; }
}

// The fields that must match for saved results to be extended by a new run.
const GUARD_FIELDS = ['set_hash', 'browser', 'browser_version', 'model_label', 'settings_requested'];
function guardDiff(meta, cur) {
  return GUARD_FIELDS.filter((f) => JSON.stringify(meta[f]) !== JSON.stringify(cur[f]))
    .map((f) => f + ': saved ' + JSON.stringify(meta[f]) + ', now ' + JSON.stringify(cur[f]));
}

// ---------------------------------------------------------------- sessions

// Try the fixed settings first; fall back step by step, and record what was accepted.
// Chrome only honours temperature/topK in some contexts (extensions, origin trials);
// elsewhere they may throw or be ignored, so we also read back what the session reports.
async function createSession(system, settings) {
  const base = { initialPrompts: [{ role: 'system', content: system }] };
  const tk = { temperature: settings.temperature, topK: settings.topK };
  const attempts = [
    { opts: { ...base, ...tk, ...LANG_OPTS }, passed: true, langs: true },
    { opts: { ...base, ...tk }, passed: true, langs: false },
    { opts: { ...base, ...LANG_OPTS }, passed: false, langs: true },
    { opts: base, passed: false, langs: false },
  ];
  let lastErr;
  for (const a of attempts) {
    try {
      const t0 = performance.now();
      const s = await LanguageModel.create(a.opts);
      const create_ms = performance.now() - t0;
      const used = {
        temperature_topK_passed: a.passed,
        languages_passed: a.langs,
        session_temperature: s.temperature ?? null, // null: the browser doesn't report it
        session_topK: s.topK ?? null,
      };
      return { s, create_ms, used };
    } catch (e) {
      if (e.name === 'NotAllowedError') throw e; // needs a user click: don't mask it
      lastErr = e;
    }
  }
  throw lastErr;
}

async function countTokens(s, text) {
  try {
    // Renamed in newer Chromium (seen in 156+): measureInputUsage -> measureContextUsage.
    if (typeof s.measureContextUsage === 'function') return await s.measureContextUsage(text);
    if (typeof s.measureInputUsage === 'function') return await s.measureInputUsage(text);
    if (typeof s.countPromptTokens === 'function') return await s.countPromptTokens(text);
  } catch { /* not supported for this input */ }
  return null;
}

async function runOne(system, settings, item, outerSignal) {
  const { s, create_ms, used } = await createSession(system, settings);
  try {
    const in_tokens = await countTokens(s, item.prompt);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new DOMException('Timed out after ' + ITEM_TIMEOUT_MS / 1000 + ' s', 'TimeoutError')), ITEM_TIMEOUT_MS);
    const onOuter = () => ctl.abort(outerSignal.reason);
    outerSignal.addEventListener('abort', onOuter);
    let out = '', ttft = null;
    const t0 = performance.now();
    try {
      for await (const chunk of s.promptStreaming(item.prompt, { signal: ctl.signal })) { // Chromium 138+ streams deltas
        if (chunk && ttft === null) ttft = performance.now() - t0;
        out += chunk;
      }
    } finally { clearTimeout(timer); outerSignal.removeEventListener('abort', onOuter); }
    const total = performance.now() - t0;
    const out_tokens = await countTokens(s, out); // tokenizer count of the reply text: an estimate of output tokens
    const genS = ttft != null && total > ttft ? (total - ttft) / 1000 : null;
    return {
      used, output: out, chars: out.length, ttft_ms: round1(ttft ?? total), total_ms: round1(total), create_ms: round1(create_ms),
      in_tokens, out_tokens, input_usage_after: s.contextUsage ?? s.inputUsage ?? null,
      tokens_source: in_tokens == null ? null : (typeof s.measureContextUsage === 'function' ? 'measureContextUsage' : 'measureInputUsage') + ' (output tokens estimated by measuring the reply text)',
      tok_per_s: out_tokens && genS ? round2(out_tokens / genS) : null,
      chars_per_s: genS ? round2(out.length / genS) : null,
    };
  } finally { s.destroy(); }
}
const round1 = (x) => x == null ? null : Math.round(x * 10) / 10;
const round2 = (x) => x == null ? null : Math.round(x * 100) / 100;

// ---------------------------------------------------------------- page

let ps, cur, store, running = false, controller = null, runTimes = [];

function render() {
  const items = ps.items, res = store?.results || {};
  ui.rows.innerHTML = items.map((it, i) => {
    const r = res[it.id];
    if (!r) return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(it.id) + '</td><td class="timed">–</td><td></td><td></td><td></td><td></td><td></td></tr>';
    const cls = r.error ? 'err' : r.pass === true ? 'pass' : r.pass === false ? 'fail' : 'timed';
    const label = r.error ? 'error' : r.pass === true ? 'pass' : r.pass === false ? 'fail' : 'timed';
    const outText = r.error || r.output || '';
    return '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(it.id) + '</td><td class="' + cls + '">' + label + '</td>' +
      '<td class="num">' + fmtMs(r.ttft_ms) + '</td><td class="num">' + fmtMs(r.total_ms) + '</td><td class="num">' + (r.chars ?? '') + '</td>' +
      '<td class="num">' + (r.in_tokens ?? '–') + ' / ' + (r.out_tokens ?? '–') + '</td>' +
      '<td class="out" title="' + esc(outText) + '">' + esc(outText.length > 160 ? outText.slice(0, 160) + '…' : outText) + '</td></tr>';
  }).join('');
  const ok = Object.values(res).filter((r) => !r.error);
  const scored = ok.filter((r) => r.pass !== null);
  $('s-done').textContent = ok.length + ' / ' + items.length;
  $('s-score').textContent = scored.length ? scored.filter((r) => r.pass).length + ' / ' + scored.length + ' (' + Math.round(100 * scored.filter((r) => r.pass).length / scored.length) + '%)' : '–';
  $('s-ttft').textContent = fmtMs(median(ok.map((r) => r.ttft_ms)));
  ui.progress.value = items.length ? ok.length / items.length : 0;
  const left = items.length - ok.length;
  $('s-eta').textContent = running && runTimes.length ? fmtEta(left * runTimes.reduce((a, b) => a + b, 0) / runTimes.length) : left ? '–' : 'done';
  ui.dl.disabled = !ok.length && !Object.keys(res).length;
  ui.clear.disabled = running || !store;
  const su = store?.meta?.settings_used;
  $('meta').innerHTML = 'Prompt set v' + esc(ps.version) + ' (<code>' + cur.set_hash + '</code>), ' + items.length + ' items. ' +
    'Requested temperature ' + ps.settings.temperature + ', topK ' + ps.settings.topK + '. ' +
    (su ? 'Used: ' + esc(describeUsed(su)) + '.' : 'Settings actually used are recorded on the first run.');
}

function describeUsed(u) {
  const parts = [u.temperature_topK_passed ? 'temperature/topK accepted by create()' : 'temperature/topK rejected, browser defaults'];
  if (u.session_temperature != null) parts.push('session reports temperature ' + u.session_temperature + ', topK ' + u.session_topK);
  else parts.push('session does not report them');
  return parts.join('; ');
}

function checkGuard() {
  if (!store) return true;
  const diff = guardDiff(store.meta, cur);
  if (!diff.length) { ui.guard.style.display = 'none'; return true; }
  ui.guard.innerHTML = '<strong>Saved results are from a different run</strong>, so they won\'t be mixed with a new one:<br>' +
    diff.map(esc).join('<br>') + '<br>Download them first if you want them, then clear to start over.';
  ui.guard.style.display = 'block';
  return false;
}

function toLines() {
  const m = store.meta;
  return ps.items.filter((it) => store.results[it.id]).map((it) => JSON.stringify({
    kind: 'result', set_version: m.set_version, set_hash: m.set_hash, runtime: 'prompt-api', runtime_version: m.browser_version,
    browser: m.browser, browser_version: m.browser_version, user_agent: m.user_agent, model_label: m.model_label, model_detail: null,
    settings_requested: m.settings_requested, settings_used: m.settings_used, ...store.results[it.id],
  })).join('\n') + '\n';
}

async function run() {
  if (running || !checkGuard()) return;
  running = true; runTimes = [];
  ui.run.disabled = true; ui.stop.disabled = false; ui.clear.disabled = true;
  controller = new AbortController();
  store ??= { meta: { ...cur, settings_used: null }, results: {} };
  // Drop errored items so they are retried.
  for (const [id, r] of Object.entries(store.results)) if (r.error) delete store.results[id];
  const todo = ps.items.filter((it) => !store.results[it.id]);
  try {
    ui.note.textContent = 'Warming up (first session can load the model)…';
    const t = performance.now();
    const warm = await createSession(ps.system, ps.settings); // inside the click: create() may need user activation
    await warm.s.prompt('Say OK.');
    warm.s.destroy();
    if (store.meta.settings_used && JSON.stringify(store.meta.settings_used) !== JSON.stringify(warm.used)) {
      throw new Error('The browser now applies different settings than the saved results (' + describeUsed(warm.used) + ' vs ' + describeUsed(store.meta.settings_used) + '). Download and clear first.');
    }
    store.meta.settings_used = warm.used;
    saveStore(store); render();
    ui.note.textContent = 'Warm-up ' + ((performance.now() - t) / 1000).toFixed(1) + ' s (not recorded). Running…';
    for (const it of todo) {
      if (controller.signal.aborted) break;
      const t0 = performance.now();
      let r;
      try {
        const m = await runOne(ps.system, ps.settings, it, controller.signal);
        if (JSON.stringify(m.used) !== JSON.stringify(store.meta.settings_used)) throw new Error('Session settings changed mid-run: ' + describeUsed(m.used));
        delete m.used;
        r = { id: it.id, category: it.category, scorer: it.scorer, ...m, pass: score(it, m.output), error: null };
      } catch (e) {
        if (controller.signal.aborted) break; // a stopped item isn't a result
        r = { id: it.id, category: it.category, scorer: it.scorer, output: null, pass: null, error: e.name + ': ' + e.message };
      }
      r.ts = new Date().toISOString();
      store.results[it.id] = r;
      saveStore(store);
      runTimes.push(performance.now() - t0);
      render();
    }
    const errs = Object.values(store.results).filter((r) => r.error).length;
    ui.note.textContent = controller.signal.aborted ? 'Stopped. Run again to resume.'
      : errs ? 'Finished with ' + errs + ' error(s). Run again to retry them.' : 'Finished. Download the JSONL and drop it into bench/results/.';
  } catch (e) {
    ui.note.textContent = (e.name === 'NotAllowedError' ? 'The browser wants a click to start the model download: press Run again. ' : 'Error: ') + e.message;
  }
  running = false;
  ui.run.disabled = false; ui.stop.disabled = true;
  ui.run.textContent = Object.keys(store.results).length < ps.items.length ? 'Resume' : 'Run again (re-runs errors only)';
  render();
}

function download() {
  const blob = new Blob([toLines()], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bench-' + store.meta.browser.toLowerCase() + '-' + (store.meta.browser_version || 'unknown') + '-' + store.meta.set_hash + '.jsonl';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function init() {
  const resp = await fetch('prompts.json', { cache: 'no-cache' });
  const buf = await resp.arrayBuffer();
  ps = JSON.parse(new TextDecoder().decode(buf));
  const br = await detectBrowser();
  cur = {
    set_version: ps.version, set_hash: (await sha256Hex(buf)).slice(0, 12),
    browser: br.name, browser_version: br.version, user_agent: navigator.userAgent,
    model_label: br.model_label, settings_requested: ps.settings,
  };
  store = loadStore();
  ui.dl.addEventListener('click', download);
  ui.stop.addEventListener('click', () => controller?.abort());
  ui.clear.addEventListener('click', () => {
    if (!confirm('Delete the saved results in this browser? Download them first if you need them.')) return;
    localStorage.removeItem(STORE_KEY); store = null; ui.guard.style.display = 'none'; ui.run.textContent = 'Run'; checkGuard(); render(); refreshRunnable();
  });
  ui.run.addEventListener('click', run);
  if (store && Object.keys(store.results).length) ui.run.textContent = 'Resume';
  checkGuard();
  render();
  await refreshRunnable();
}

let runnable = false;
async function refreshRunnable() {
  runnable = await checkModel();
  ui.run.disabled = !runnable || !checkGuard();
}

async function checkModel() {
  if (!('LanguageModel' in self)) {
    status('bad', 'No Prompt API in this browser', 'Open this page in Chrome or Edge with the built-in model switched on (see the chat page for the flags).');
    return false;
  }
  let avail;
  try { avail = await LanguageModel.availability(LANG_OPTS); }
  catch {
    try { avail = await LanguageModel.availability(); }
    catch (e) { status('bad', cur.model_label, 'Availability check failed: ' + e.message); return false; }
  }
  if (avail === 'unavailable') {
    status('bad', cur.model_label + ' unavailable', 'The Prompt API is present, but no model can run here (hardware, disk, language or not installed). Nothing to benchmark.');
    return false;
  }
  if (avail === 'available') status('ok', cur.model_label + ' ready', cur.browser + ' ' + (cur.browser_version || '') + '. Close other heavy tabs for steadier timings.');
  else status('warn', cur.model_label + ' needs to download', 'Run starts the one-off download (several GB), then the benchmark.');
  return true;
}

init().catch((e) => status('bad', 'Bench failed to load', e.message));
