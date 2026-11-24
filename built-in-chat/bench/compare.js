// Load bench JSONL files (committed ones via results/index.json, plus any dropped in) and tabulate.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const median = (a) => { a = a.filter((x) => x != null); if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const ms = (x) => x == null ? '–' : x < 1000 ? Math.round(x) + ' ms' : (x / 1000).toFixed(2) + ' s';
const n0 = (x) => x == null ? '–' : Math.round(x).toLocaleString();

const runs = new Map(); // key -> { label, runtime, version, set_hash, settings, byId }
const loaded = [];

function addLines(name, text) {
  let n = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.kind !== 'result') continue;
    const version = r.browser_version || r.runtime_version || '';
    const key = [r.runtime, r.model_label, version, r.set_hash].join('|');
    if (!runs.has(key)) runs.set(key, { label: r.model_label, runtime: r.runtime, version, set_hash: r.set_hash, used: r.settings_used, detail: r.model_detail, byId: {} });
    runs.get(key).byId[r.id] = r; // later files win for the same item
    n++;
  }
  loaded.push(name + ' (' + n + ')');
}

function catScore(rs, cat) {
  const s = rs.filter((r) => r.category === cat && r.pass != null);
  return s.length ? s.filter((r) => r.pass).length + '/' + s.length : '–';
}

function render() {
  $('files').textContent = loaded.length ? 'Loaded: ' + loaded.join(', ') : 'No results loaded yet.';
  const list = [...runs.values()].sort((a, b) => (a.runtime + a.label).localeCompare(b.runtime + b.label));
  $('summary').innerHTML = list.map((u) => {
    const rs = Object.values(u.byId).filter((r) => !r.error);
    const sc = rs.filter((r) => r.pass != null), p = sc.filter((r) => r.pass).length;
    const open = rs.filter((r) => r.category === 'open'); // short answers are 1-2 chunks: no meaningful rate
    const rt = u.runtime === 'ollama' ? 'Ollama ' + u.version + (u.detail?.quantization ? ', ' + u.detail.quantization : '') : (u.runtime + ' ' + u.version);
    const tokSrc = rs.find((r) => r.tokens_source)?.tokens_source || 'none';
    return '<tr><td><strong>' + esc(u.label) + '</strong></td><td>' + esc(rt) + '</td><td><code>' + esc(u.set_hash?.slice(0, 6)) + '</code></td>' +
      '<td class="num">' + p + '/' + sc.length + '</td><td class="num">' + catScore(rs, 'arithmetic') + '</td><td class="num">' + catScore(rs, 'extraction') + '</td><td class="num">' + catScore(rs, 'format') + '</td>' +
      '<td class="num">' + ms(median(rs.map((r) => r.ttft_ms))) + '</td><td class="num">' + ms(median(rs.map((r) => r.total_ms))) + '</td>' +
      '<td class="num">' + n0(median(open.map((r) => r.chars_per_s))) + '</td><td class="num">' + n0(median(open.map((r) => r.tok_per_s))) + '</td>' +
      '<td class="na">' + esc(tokSrc.split(' (')[0]) + '</td></tr>';
  }).join('') || '<tr><td colspan="12" class="na">Nothing yet.</td></tr>';

  const ids = [];
  for (const u of list) for (const id of Object.keys(u.byId)) if (!ids.includes(id)) ids.push(id);
  $('item-head').innerHTML = '<tr><th>Item</th>' + list.map((u) => '<th>' + esc(u.label) + '</th>').join('') + '</tr>';
  $('items').innerHTML = ids.map((id) => '<tr><td>' + esc(id) + '</td>' + list.map((u) => {
    const r = u.byId[id];
    if (!r) return '<td class="na">–</td>';
    const [cls, mark] = r.error ? ['fail', 'error'] : r.pass === true ? ['pass', '✓'] : r.pass === false ? ['fail', '✗'] : ['na', 'timed'];
    return '<td class="' + cls + '" title="' + esc(r.error || r.output) + '">' + mark + ' <span class="na">' + ms(r.total_ms) + '</span></td>';
  }).join('') + '</tr>').join('');
}

async function loadCommitted() {
  try {
    const idx = await (await fetch('results/index.json', { cache: 'no-cache' })).json();
    for (const f of idx.files) {
      const r = await fetch('results/' + encodeURIComponent(f), { cache: 'no-cache' });
      if (r.ok) addLines(f, await r.text());
    }
  } catch { /* opened from file:// or no index: drop files instead */ }
  render();
}

async function addFiles(files) {
  for (const f of files) addLines(f.name, await f.text());
  render();
}

const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
$('pick').addEventListener('click', (e) => { e.preventDefault(); $('file').click(); });
$('file').addEventListener('change', (e) => addFiles(e.target.files));

loadCommitted();
