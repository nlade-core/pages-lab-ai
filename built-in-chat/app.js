// Built-in model chat: one chat UI over whichever local model is available.
//  - In the browser: the Prompt API (LanguageModel). Chrome -> Gemini Nano, Edge -> Phi-4-mini.
//    The API can't report which model it wraps, so the label comes from the browser brand.
//  Ollama was tried as a third option and parked: see OLLAMA.md.

const SYSTEM_PROMPT = 'You are a helpful, concise assistant.';

const $ = (id) => document.getElementById(id);

function card(id) {
  const root = $(id);
  const q = (s) => root.querySelector('[data-' + s + ']');
  const c = { dot: q('dot'), model: q('model'), detail: q('detail'), setup: q('setup'), controls: q('controls'), progress: q('progress') };
  c.status = (kind, model, detail) => { c.dot.className = 'dot ' + kind; c.model.textContent = model; c.detail.textContent = detail || ''; };
  c.showSetup = (html) => { c.setup.innerHTML = html; c.setup.style.display = 'block'; };
  c.hideSetup = () => { c.setup.style.display = 'none'; };
  c.setControls = (...els) => c.controls.replaceChildren(...els);
  return c;
}

function button(label, onClick, secondary) {
  const b = document.createElement('button');
  b.textContent = label;
  if (secondary) b.className = 'secondary';
  b.addEventListener('click', onClick);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------- browser model

const BROWSERS = {
  edge: {
    name: 'Microsoft Edge', model: 'Phi-4-mini',
    flag: 'edge://flags/#edge-llm-prompt-api-for-phi-mini',
    extra: 'Needs Edge Canary or Dev (version 138+) on Windows 10/11 or macOS 13.3+, with a capable GPU and ~20 GB free disk.',
  },
  chrome: {
    name: 'Google Chrome', model: 'Gemini Nano',
    flag: 'chrome://flags/#prompt-api-for-gemini-nano',
    extra: 'Also set chrome://flags/#optimization-guide-on-device-model to "Enabled BypassPerfRequirement" if your machine is borderline. Needs ~22 GB free disk.',
  },
};

function detectBrowser() {
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand);
  if (brands.includes('Microsoft Edge') || /\bEdg\//.test(navigator.userAgent)) return 'edge';
  if (brands.includes('Google Chrome')) return 'chrome';
  return 'other';
}

// The API decides whether we can run; the brand only decides the label.
const browser = BROWSERS[detectBrowser()] || { name: 'this browser', model: 'Built-in model', flag: null, extra: '' };

// Chrome warns (and may refuse) without declared languages; older Edge builds
// may reject unknown options. Try with them, fall back to without.
const LANG_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

const bc = card('p-builtin');

function builtinSetupSteps() {
  if (!browser.flag) {
    return '<p>Built-in models ship in Chrome and Edge on desktop. </p>';
  }
  return '<ol>' +
    '<li>Open <code>' + browser.flag + '</code> in a new tab (copy-paste it; pages can\'t link to flags).</li>' +
    '<li>Set it to <strong>Enabled</strong>, then relaunch the browser.</li>' +
    '<li>Come back here. ' + browser.extra + '</li>' +
    '</ol>';
}

async function builtinCreateSession() {
  const opts = {
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        bc.progress.style.display = 'block';
        bc.progress.value = e.loaded;
        bc.status('warn', browser.model, 'Downloading model… ' + Math.round(e.loaded * 100) + '%');
      });
    },
  };
  try { return await LanguageModel.create({ ...opts, ...LANG_OPTS }); }
  catch (e) {
    if (e.name === 'NotAllowedError') throw e; // needs a user click; don't mask it
    return await LanguageModel.create(opts);
  }
}

const builtinProvider = {
  label: browser.model,
  session: null,
  async begin() { this.session = await builtinCreateSession(); },
  async *stream(text, _prior, signal) {
    for await (const chunk of this.session.promptStreaming(text, { signal })) yield chunk; // Chromium 138+ streams deltas
  },
  stats() {
    const used = this.session.inputUsage ?? this.session.tokensSoFar;
    const quota = this.session.inputQuota ?? this.session.maxTokens;
    return used != null && quota ? ' Context: ' + used + ' / ' + quota + ' tokens.' : '';
  },
  async reset() { this.session?.destroy(); this.session = await builtinCreateSession(); },
  end() { this.session?.destroy(); this.session = null; },
};

async function initBuiltin() {
  if (!('LanguageModel' in self)) {
    bc.status('bad', browser.flag ? browser.model + ' is not switched on' : 'No built-in model in this browser',
      browser.flag ? browser.name + ' detected, but the Prompt API isn\'t exposed to web pages yet.' : 'Your browser doesn\'t expose the Prompt API.');
    bc.showSetup(builtinSetupSteps());
    return;
  }
  let avail;
  try { avail = await LanguageModel.availability(LANG_OPTS); }
  catch {
    try { avail = await LanguageModel.availability(); }
    catch (e) { bc.status('bad', browser.model, 'Availability check failed: ' + e.message); return; }
  }
  if (avail === 'unavailable') {
    bc.status('bad', browser.model + ' unavailable', 'The API is on, but this device doesn\'t meet the hardware/disk requirements, or the language isn\'t supported.');
    bc.showSetup(builtinSetupSteps());
    return;
  }
  if (avail === 'available') {
    bc.status('ok', browser.model + ' ready', 'Runs inside ' + browser.name + ' on this device.');
  } else {
    // 'downloadable' or 'downloading': create() must come from a click.
    bc.status('warn', browser.model + ' needs to download', 'One-off download, several GB. Stored by the browser and shared with every site.');
  }
  const label = avail === 'available' ? 'Use ' + browser.model
    : avail === 'downloading' ? 'Continue (download in progress)' : 'Download model and start';
  const b = button(label, async () => {
    b.disabled = true;
    try { await builtinProvider.begin(); }
    catch (e) { bc.status('bad', browser.model, 'Couldn\'t start a session: ' + e.message); b.disabled = false; return; }
    bc.progress.style.display = 'none';
    bc.status('ok', browser.model + ' ready', 'Runs inside ' + browser.name + ' on this device.');
    b.textContent = 'Use ' + browser.model;
    b.disabled = false;
    startChat(builtinProvider);
  });
  bc.setControls(b);
}

// ---------------------------------------------------------------- chat

const statusPanel = $('status-panel'), workspace = $('workspace'), chatLog = $('chat-log');
const chatInput = $('chat-input'), sendBtn = $('send-btn'), stopBtn = $('stop-btn');
const resetBtn = $('reset-btn'), chatNote = $('chat-note'), talkingTo = $('talking-to');

let active = null, history = [], generating = false, controller = null;

function startChat(provider) {
  active = provider;
  history = [];
  render();
  chatNote.textContent = '';
  talkingTo.textContent = provider.label;
  statusPanel.style.display = 'none';
  workspace.classList.add('active');
  chatInput.focus();
}

function render() {
  chatLog.innerHTML = history
    .map((m) => '<div class="msg ' + m.role + '"><span class="role">' + escapeHtml(m.role === 'user' ? 'you' : active.label) + '</span>' + escapeHtml(m.content) + '</div>')
    .join('');
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function send() {
  const text = chatInput.value.trim();
  if (!text || generating || !active) return;
  chatInput.value = '';
  const prior = history.map(({ role, content }) => ({ role, content }));
  history.push({ role: 'user', content: text }, { role: 'assistant', content: '' });
  render();

  generating = true;
  sendBtn.disabled = true;
  stopBtn.style.display = 'inline-block';
  chatNote.textContent = 'Waiting for the first token…';
  controller = new AbortController();
  const reply = history[history.length - 1];
  const t0 = performance.now();

  try {
    for await (const chunk of active.stream(text, prior, controller.signal)) {
      if (!reply.content) chatNote.textContent = 'Generating…';
      reply.content += chunk;
      render();
    }
    chatNote.textContent = 'Answered in ' + ((performance.now() - t0) / 1000).toFixed(1) + 's by ' + active.label + ', on-device.' + active.stats();
  } catch (e) {
    chatNote.textContent = e.name === 'AbortError' ? 'Stopped.' : 'Error: ' + e.message;
    if (!reply.content) { history.splice(-2, 2); render(); }
  }

  generating = false;
  sendBtn.disabled = false;
  stopBtn.style.display = 'none';
  chatInput.focus();
}

sendBtn.addEventListener('click', send);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
stopBtn.addEventListener('click', () => controller?.abort());
resetBtn.addEventListener('click', async () => {
  controller?.abort();
  history = [];
  render();
  chatNote.textContent = '';
  try { await active.reset(); }
  catch (e) { chatNote.textContent = 'Couldn\'t start a new session: ' + e.message; }
});

initBuiltin();
