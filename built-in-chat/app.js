// Built-in model chat: one chat UI over whichever local model is available.
//  - In the browser: the Prompt API (LanguageModel). Chrome -> Gemini Nano, Edge -> Phi-4-mini.
//    The API can't report which model it wraps, so the label comes from the browser brand.
//  - On the computer: Ollama on localhost, contacted only after the visitor clicks Connect
//    (no silent localhost probing on page load), cloud-routed Ollama models filtered out.

const SYSTEM_PROMPT = 'You are a helpful, concise assistant.';
const OLLAMA = 'http://127.0.0.1:11434';
const OLLAMA_PREFERRED = ['phi4-mini', 'gemma3:4b', 'qwen3.5:4b', 'gemma3n:e2b', 'llama3.2', 'llama3.1:8b'];

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

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
const isSafari = /Safari\//.test(navigator.userAgent) && !/Chrome\/|Chromium\//.test(navigator.userAgent);

// Chrome warns (and may refuse) without declared languages; older Edge builds
// may reject unknown options. Try with them, fall back to without.
const LANG_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

const bc = card('p-builtin');

function builtinSetupSteps() {
  if (!browser.flag) {
    return '<p>Built-in models ship in Chrome and Edge on desktop. In other browsers, use Ollama below.</p>';
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

// ---------------------------------------------------------------- Ollama

const oc = card('p-ollama');

function ollamaOriginSteps() {
  const origin = location.origin;
  return '<p>Ollama is running, but it only accepts requests from pages on <code>localhost</code> unless you allow this site. Run the command for your OS, then quit and reopen Ollama:</p>' +
    '<div class="os">macOS</div><pre>launchctl setenv OLLAMA_ORIGINS "' + origin + '"</pre>' +
    '<div class="os">Windows (PowerShell)</div><pre>setx OLLAMA_ORIGINS "' + origin + '"</pre>' +
    '<div class="os">Linux (systemd)</div><pre>sudo systemctl edit ollama\n# add under [Service]:\nEnvironment="OLLAMA_ORIGINS=' + origin + '"\nsudo systemctl restart ollama</pre>' +
    '<p>If you already set <code>OLLAMA_ORIGINS</code> for something else, add this site to it with a comma. On macOS the setting lasts until you restart your Mac.</p>';
}

function ollamaNotRunningSteps() {
  let html = '<ol>' +
    '<li>Install <a href="https://ollama.com/download" target="_blank" rel="noopener">Ollama</a> and make sure it\'s running.</li>' +
    '<li>Pull a small model, for example <code>ollama pull phi4-mini</code>.</li>' +
    '<li>If your browser asks to let this site access devices on your local network, allow it. That\'s how it reaches Ollama on your computer.</li>' +
    '</ol>';
  if (isSafari) html += '<p>Safari blocks secure pages from calling <code>http://localhost</code>, so this won\'t work in Safari. Use Chrome, Edge or Firefox.</p>';
  return html;
}

function pickDefault(models) {
  const saved = store.get('ollama-model');
  if (saved && models.some((m) => m.name === saved)) return saved;
  for (const p of OLLAMA_PREFERRED) {
    const hit = models.find((m) => m.name === p || m.name.startsWith(p + ':') || m.name.startsWith(p));
    if (hit) return hit.name;
  }
  return (models.find((m) => m.size >= 1e9) || models[0]).name;
}

const ollamaProvider = {
  label: 'Ollama',
  model: null,
  last: null,
  async begin() {},
  async *stream(text, prior, signal) {
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...prior, { role: 'user', content: text }];
    const r = await fetch(OLLAMA + '/api/chat', {
      method: 'POST',
      body: JSON.stringify({ model: this.model, messages, stream: true, think: false }),
      signal,
    });
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { msg = (await r.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const d = JSON.parse(line);
        if (d.error) throw new Error(d.error);
        if (d.message?.content) yield d.message.content;
        if (d.done) this.last = d;
      }
    }
  },
  stats() {
    const d = this.last;
    if (!d?.eval_count || !d.eval_duration) return '';
    return ' ' + d.eval_count + ' tokens at ' + (d.eval_count / (d.eval_duration / 1e9)).toFixed(1) + ' tok/s.';
  },
  async reset() {},
  end() {},
};

async function ollamaConnect() {
  oc.hideSetup();
  oc.setControls();
  oc.status('warn', 'Ollama', 'Connecting to ' + OLLAMA + '…');

  let tags;
  try {
    const r = await fetch(OLLAMA + '/api/tags');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    tags = await r.json();
  } catch {
    // A CORS rejection and "nothing listening" look identical to fetch().
    // An opaque no-cors request succeeds if something answered, so it tells them apart.
    let answered = false;
    try { await fetch(OLLAMA + '/api/version', { mode: 'no-cors' }); answered = true; } catch {}
    if (answered) {
      oc.status('bad', 'Ollama is blocking this site', 'It\'s running on your computer but rejected a request from ' + location.origin + '.');
      oc.showSetup(ollamaOriginSteps());
    } else {
      store.del('ollama-connected');
      oc.status('bad', 'Ollama not reachable', 'Nothing answered at ' + OLLAMA + ', or your browser blocked the request.');
      oc.showSetup(ollamaNotRunningSteps());
    }
    oc.setControls(button('Try again', ollamaConnect, true));
    return;
  }

  // Local chat models only: cloud models (remote_host) would send prompts off the device.
  const all = tags.models || [];
  const models = all
    .filter((m) => !m.remote_host)
    .filter((m) => (m.capabilities ? m.capabilities.includes('completion') : m.size > 1e7 && !/embed/i.test(m.name)))
    .sort((a, b) => a.size - b.size);
  const skippedCloud = all.filter((m) => m.remote_host).length;

  if (!models.length) {
    oc.status('warn', 'Ollama connected, no local chat models', skippedCloud ? skippedCloud + ' cloud model(s) hidden, since they don\'t run on your device.' : '');
    oc.showSetup('<p>Pull one, then try again: <code>ollama pull phi4-mini</code></p>');
    oc.setControls(button('Try again', ollamaConnect, true));
    return;
  }

  store.set('ollama-connected', '1');
  oc.status('ok', 'Ollama connected', models.length + ' local chat model' + (models.length > 1 ? 's' : '') +
    (skippedCloud ? ', ' + skippedCloud + ' cloud model(s) hidden' : '') + '. Larger models take a while to load on first reply.');

  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Ollama model');
  const def = pickDefault(models);
  sel.innerHTML = models.map((m) =>
    '<option value="' + escapeHtml(m.name) + '"' + (m.name === def ? ' selected' : '') + '>' +
    escapeHtml(m.name) + ' · ' + (m.size / 1e9).toFixed(1) + ' GB</option>').join('');
  oc.setControls(sel, button('Use Ollama', () => {
    ollamaProvider.model = sel.value;
    ollamaProvider.label = sel.value + ' (Ollama)';
    store.set('ollama-model', sel.value);
    startChat(ollamaProvider);
  }), button('Refresh', ollamaConnect, true));
}

function initOllama() {
  // Reconnect automatically only for visitors who connected before.
  if (store.get('ollama-connected')) ollamaConnect();
  else oc.setControls(button('Connect to Ollama', ollamaConnect, true));
}

// ---------------------------------------------------------------- chat

const statusPanel = $('status-panel'), workspace = $('workspace'), chatLog = $('chat-log');
const chatInput = $('chat-input'), sendBtn = $('send-btn'), stopBtn = $('stop-btn');
const resetBtn = $('reset-btn'), switchBtn = $('switch-btn'), chatNote = $('chat-note'), talkingTo = $('talking-to');

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
switchBtn.addEventListener('click', () => {
  controller?.abort();
  active?.end();
  active = null;
  workspace.classList.remove('active');
  statusPanel.style.display = '';
});

initBuiltin();
initOllama();
