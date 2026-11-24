// Scorers for prompts.json. bench_ollama.py has a line-for-line Python copy: change both together.

const STRIP = '"\'`*_“”‘’ \t\r\n';

function stripEnds(s) {
  let a = 0, b = s.length;
  while (a < b && STRIP.includes(s[a])) a++;
  while (b > a && (STRIP + '.!?').includes(s[b - 1])) b--;
  return s.slice(a, b);
}

function lastNumber(s) {
  const t = s.replace(/−/g, '-').replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  const m = t.match(/-?\d+(?:\.\d+)?/g);
  return m ? Number(m[m.length - 1]) : null;
}

function stripFences(s) {
  const m = s.trim().match(/^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : s.trim();
}

function same(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase() === b.trim().toLowerCase();
  return JSON.stringify(a) === JSON.stringify(b);
}

// Returns true / false, or null for unscored items.
export function score(item, output) {
  const out = output ?? '';
  switch (item.scorer) {
    case 'exact': return stripEnds(out).toLowerCase() === String(item.expect).toLowerCase();
    case 'exact_case': return out.trim() === item.expect;
    case 'number': { const n = lastNumber(out); return n !== null && Math.abs(n - item.expect) < 1e-9; }
    case 'word_count': return out.trim().split(/\s+/).filter(Boolean).length === item.expect;
    case 'csv_set': {
      const got = new Set(out.split(',').map((x) => stripEnds(x).toLowerCase()).filter(Boolean));
      const want = new Set(item.expect.map((x) => x.toLowerCase()));
      return got.size === want.size && [...want].every((x) => got.has(x));
    }
    case 'json': {
      let obj;
      try { obj = JSON.parse(stripFences(out)); } catch { return false; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
      return Object.entries(item.expect).every(([k, v]) => k in obj && same(obj[k], v));
    }
    case 'timed': return null;
    default: throw new Error('Unknown scorer: ' + item.scorer);
  }
}
