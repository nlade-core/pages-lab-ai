// Built-in model chat: one Prompt API code path, whichever model the browser ships.
// Chrome -> Gemini Nano, Edge -> Phi-4-mini. The API can't report which model it
// wraps, so the label comes from the browser brand.

const SYSTEM_PROMPT = 'You are a helpful, concise assistant.';

const $ = (id) => document.getElementById(id);
const dot = $('status-dot'), modelEl = $('status-model'), detailEl = $('status-detail');
const setupEl = $('setup'), progressEl = $('dl-progress'), startBtn = $('start-btn');
const workspace = $('workspace'), chatLog = $('chat-log'), chatInput = $('chat-input');
const sendBtn = $('send-btn'), stopBtn = $('stop-btn'), resetBtn = $('reset-btn'), chatNote = $('chat-note');

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
// Unbranded Chromium builds can still expose LanguageModel.
const browserKey = detectBrowser();
const browser = BROWSERS[browserKey] || {
  name: 'this browser', model: 'Built-in model', flag: null,
  extra: '',
};

function setStatus(kind, model, detail) {
  dot.className = 'dot ' + kind;
  modelEl.textContent = model;
  detailEl.textContent = detail || '';
}

function showSetup(html) {
  setupEl.innerHTML = html;
  setupEl.style.display = 'block';
}

function setupSteps() {
  if (!browser.flag) {
    return '<p>This page needs Chrome or Edge on desktop. Other browsers don\'t ship a built-in model yet.</p>';
  }
  return '<ol>' +
    '<li>Open <code>' + browser.flag + '</code> in a new tab (copy-paste it; pages can\'t link to flags).</li>' +
    '<li>Set it to <strong>Enabled</strong>, then relaunch the browser.</li>' +
    '<li>Come back here. ' + browser.extra + '</li>' +
    '</ol>';
}

// Chrome warns (and may refuse) without declared languages; older Edge builds
// may reject unknown options. Try with them, fall back to without.
const LANG_OPTS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] };

async function availability() {
  try { return await LanguageModel.availability(LANG_OPTS); }
  catch { return await LanguageModel.availability(); }
}

let session = null, history = [], generating = false, controller = null;

async function createSession() {
  const opts = {
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        progressEl.style.display = 'block';
        progressEl.value = e.loaded;
        setStatus('warn', browser.model, 'Downloading model… ' + Math.round(e.loaded * 100) + '%');
      });
    },
  };
  try { return await LanguageModel.create({ ...opts, ...LANG_OPTS }); }
  catch (e) {
    if (e.name === 'NotAllowedError') throw e; // needs a user click; don't mask it
    return await LanguageModel.create(opts);
  }
}

async function init() {
  if (!('LanguageModel' in self) && !browser.flag) {
    setStatus('bad', 'No built-in model in this browser', 'Your browser doesn\'t expose the Prompt API.');
    showSetup(setupSteps());
    return;
  }
  if (!('LanguageModel' in self)) {
    setStatus('bad', browser.model + ' is not switched on', browser.name + ' detected, but the Prompt API isn\'t exposed to web pages yet.');
    showSetup(setupSteps());
    return;
  }

  let avail;
  try { avail = await availability(); }
  catch (e) { setStatus('bad', browser.model, 'Availability check failed: ' + e.message); return; }

  if (avail === 'unavailable') {
    setStatus('bad', browser.model + ' unavailable', 'The API is on, but this device doesn\'t meet the hardware/disk requirements, or the language isn\'t supported.');
    showSetup(setupSteps());
    return;
  }
  if (avail === 'available') {
    setStatus('ok', browser.model + ' ready', 'Running inside ' + browser.name + ' on this device.');
  } else {
    // 'downloadable' or 'downloading': create() must come from a click.
    setStatus('warn', browser.model + ' needs to download', 'One-off download, several GB. It\'s stored by the browser and shared with every site.');
    startBtn.textContent = avail === 'downloading' ? 'Continue (download in progress)' : 'Download model and start';
  }
  startBtn.style.display = 'inline-block';
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    session = await createSession();
  } catch (e) {
    setStatus('bad', browser.model, 'Couldn\'t start a session: ' + e.message);
    startBtn.disabled = false;
    return;
  }
  progressEl.style.display = 'none';
  setStatus('ok', browser.model + ' ready', 'Running inside ' + browser.name + ' on this device.');
  startBtn.style.display = 'none';
  workspace.classList.add('active');
  chatInput.focus();
});

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function render() {
  chatLog.innerHTML = history
    .map((m) => '<div class="msg ' + m.role + '"><span class="role">' + (m.role === 'user' ? 'you' : browser.model) + '</span>' + escapeHtml(m.content) + '</div>')
    .join('');
  chatLog.scrollTop = chatLog.scrollHeight;
}

function usageText() {
  const used = session.inputUsage ?? session.tokensSoFar;
  const quota = session.inputQuota ?? session.maxTokens;
  return used != null && quota ? ' Context: ' + used + ' / ' + quota + ' tokens.' : '';
}

async function send() {
  const text = chatInput.value.trim();
  if (!text || generating || !session) return;
  chatInput.value = '';
  history.push({ role: 'user', content: text }, { role: 'assistant', content: '' });
  render();

  generating = true;
  sendBtn.disabled = true;
  stopBtn.style.display = 'inline-block';
  chatNote.textContent = 'Generating…';
  controller = new AbortController();
  const reply = history[history.length - 1];
  const t0 = performance.now();

  try {
    const stream = session.promptStreaming(text, { signal: controller.signal });
    for await (const chunk of stream) {
      reply.content += chunk; // Chromium 138+ (Chrome and Edge) streams deltas
      render();
    }
    chatNote.textContent = 'Answered in ' + ((performance.now() - t0) / 1000).toFixed(1) + 's by ' + browser.model + ', on-device.' + usageText();
  } catch (e) {
    chatNote.textContent = e.name === 'AbortError' ? 'Stopped.' : 'Error: ' + e.message;
    if (!reply.content) history.splice(-2, 2), render();
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
  session?.destroy();
  history = [];
  render();
  chatNote.textContent = '';
  try { session = await createSession(); }
  catch (e) { chatNote.textContent = 'Couldn\'t start a new session: ' + e.message; }
});

init();
