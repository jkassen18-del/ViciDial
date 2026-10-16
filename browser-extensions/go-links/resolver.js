// Pure go-link resolution logic: no browser APIs, so it runs (and is unit-tested) in Node.
//
// Keys
//   Case-insensitive. Allowed characters are a-z, 0-9, ".", "-" and "_".
//   "-" and "_" are treated as the same character when matching (go/time_off == go/time-off).
//   If nothing matches exactly, a "compact" match that ignores "-", "_" and "." is tried
//   (go/orgchart finds go/org-chart) as long as it is unambiguous.
//   Aliases resolve to the same link. Keys always beat aliases.
//
// Paths and parameters
//   go/key/a/b?x=1#frag      args = ["a", "b"], query "x=1" and hash "frag" are forwarded.
//   go key a b               omnibox style (spaces), args = ["a", "b"], {*} = "a b".
//   {1}, {2} …               positional segments, URL-encoded.
//   {*}                      everything after the positional segments. In the URL path it keeps
//                            "/" between segments; in the query string it is fully encoded
//                            (spaces become %20, "/" becomes %2F).
//   No args on a parameterised link → `home` if set, otherwise the placeholders are removed
//   and the URL is tidied (empty query parameters and trailing slashes dropped).
//   Extra segments on a link that has no (or not enough) placeholders are appended to the
//   URL path: go/wiki-home/foo → https://wiki.example/foo (when the url has no {…}).
//
// Precedence
//   Layers are passed in order: inline/policy links, then each source, then personal links.
//   Company links (policy + sources) are indexed first; personal links can never shadow a
//   company key or alias; a shadowed personal link is reported in `conflicts`.

export const PLACEHOLDER_RE = /\{(\d+|\*)\}/g;
const KEY_CHARS = /[^a-z0-9._-]/g;

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lower-cases and strips characters that are not allowed in a key ("_" kept for display). */
export function cleanKey(input) {
  return String(input ?? '').trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(KEY_CHARS, '')
    .replace(/^[._-]+|[._-]+$/g, '');
}

/** The form used for matching: cleaned, with "_" folded into "-". */
export function matchKey(input) {
  return cleanKey(input).replace(/_/g, '-');
}

/** Loosest form: ignores separators entirely (orgchart == org-chart == org.chart). */
export function compactKey(input) {
  return matchKey(input).replace(/[.-]/g, '');
}

export function isValidKey(key) {
  return /^[a-z0-9]([a-z0-9._-]{0,62}[a-z0-9])?$/.test(String(key || ''));
}

export function isParameterised(url) {
  return /\{(\d+|\*)\}/.test(String(url || ''));
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Only web URLs may be used as targets (blocks javascript:, data:, file: …). */
export function isSafeUrl(url) {
  return /^https?:\/\/[^\s/?#]+/i.test(String(url || '').trim());
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const asList = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [])
  .map((s) => String(s).trim()).filter(Boolean);

/**
 * Cleans one link object. Returns { link, errors } where link is null when unusable.
 */
export function cleanLink(raw, { department } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { link: null, errors: ['not an object'] };
  const key = cleanKey(raw.key);
  if (!key) errors.push('missing "key"');
  else if (!isValidKey(key)) errors.push(`key "${raw.key}" has invalid characters (use a-z, 0-9, ".", "-", "_")`);
  const url = String(raw.url ?? '').trim();
  if (!url) errors.push('missing "url"');
  else if (!isSafeUrl(url)) errors.push(`url "${url}" must start with http:// or https://`);
  const home = raw.home ? String(raw.home).trim() : '';
  if (home && !isSafeUrl(home)) errors.push(`home "${home}" must start with http:// or https://`);
  if (errors.length) return { link: null, errors };
  const aliases = [...new Set(asList(raw.aliases).map(cleanKey).filter((a) => isValidKey(a) && a !== key))];
  const link = {
    key,
    url,
    title: String(raw.title ?? '').trim() || key,
    description: String(raw.description ?? '').trim(),
    department: String(raw.department ?? '').trim() || String(department ?? '').trim(),
    tags: [...new Set(asList(raw.tags).map((t) => t.toLowerCase()))],
    aliases,
    featured: raw.featured === true,
    owner: String(raw.owner ?? '').trim(),
  };
  if (home) link.home = home;
  return { link, errors };
}

/**
 * Validates a source document ({ name, updated, links: [] } or a bare array).
 * Returns { ok, name, updated, links, errors, warnings }.
 */
export function validateSource(json, { department } = {}) {
  const errors = [];
  const warnings = [];
  let doc = json;
  if (typeof doc === 'string') {
    try { doc = JSON.parse(doc); } catch (err) { return { ok: false, links: [], errors: [`Not valid JSON: ${err.message}`], warnings }; }
  }
  if (Array.isArray(doc)) doc = { links: doc };
  if (!doc || typeof doc !== 'object') return { ok: false, links: [], errors: ['Expected a JSON object with a "links" array'], warnings };
  if (!Array.isArray(doc.links)) return { ok: false, links: [], errors: ['Missing "links" array'], warnings };
  const links = [];
  const seen = new Set();
  doc.links.forEach((raw, i) => {
    const { link, errors: e } = cleanLink(raw, { department });
    const label = raw && raw.key ? `links[${i}] (${raw.key})` : `links[${i}]`;
    if (!link) { warnings.push(`${label}: ${e.join(', ')}`); return; }
    const id = matchKey(link.key);
    if (seen.has(id)) { warnings.push(`${label}: duplicate key, ignored`); return; }
    seen.add(id);
    links.push(link);
  });
  if (doc.links.length && !links.length) errors.push('None of the links are valid');
  return {
    ok: errors.length === 0,
    name: typeof doc.name === 'string' ? doc.name.trim() : '',
    updated: typeof doc.updated === 'string' ? doc.updated : '',
    links,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

/**
 * @param {Array<{id, name, kind:'policy'|'source'|'personal', department?, links}>} layers
 *   in precedence order.
 * @returns index { links, byKey, byAlias, byCompact, conflicts, shadowed }
 */
export function buildIndex(layers = []) {
  const byKey = new Map();
  const byAlias = new Map();
  const links = [];
  const conflicts = [];
  const shadowed = [];

  const tiers = [
    layers.filter((l) => l.kind !== 'personal'),
    layers.filter((l) => l.kind === 'personal'),
  ];
  let order = 0;
  for (const tier of tiers) {
    const tierLinks = [];
    for (const layer of tier) {
      for (const raw of layer.links || []) {
        const { link } = cleanLink(raw, { department: layer.department });
        if (!link) continue;
        const entry = {
          ...link,
          id: matchKey(link.key),
          aliasIds: link.aliases.map(matchKey),
          sourceId: layer.id,
          sourceName: layer.name || layer.id,
          kind: layer.kind || 'source',
          personal: layer.kind === 'personal',
          order: order++,
        };
        const taken = byKey.get(entry.id) || byAlias.get(entry.id);
        if (taken) {
          const c = { key: link.key, kind: taken.id === entry.id ? 'key' : 'alias', winner: ref(taken), loser: ref(entry) };
          conflicts.push(c);
          if (entry.personal) shadowed.push({ ...entry, conflictWith: ref(taken) });
          continue;
        }
        byKey.set(entry.id, entry);
        tierLinks.push(entry);
        links.push(entry);
      }
    }
    // aliases after all keys of the tier, so a key always beats an alias
    for (const entry of tierLinks) {
      entry.activeAliases = [];
      entry.aliases.forEach((alias, i) => {
        const id = entry.aliasIds[i];
        const taken = byKey.get(id) || byAlias.get(id);
        if (taken && taken !== entry) {
          conflicts.push({ key: alias, kind: 'alias', winner: ref(taken), loser: ref(entry) });
          return;
        }
        byAlias.set(id, entry);
        entry.activeAliases.push(alias);
      });
    }
  }

  const byCompact = new Map();
  for (const e of links) {
    for (const k of [e.id, ...e.aliasIds]) {
      const c = compactKey(k);
      if (!c) continue;
      if (byCompact.has(c) && byCompact.get(c) !== e) byCompact.set(c, null); // ambiguous
      else byCompact.set(c, e);
    }
  }
  return { links, byKey, byAlias, byCompact, conflicts, shadowed };
}

function ref(e) {
  return { key: e.key, title: e.title, sourceId: e.sourceId, sourceName: e.sourceName, kind: e.kind };
}

/** Finds the link for a key or alias (or null). */
export function lookup(index, key) {
  const id = matchKey(key);
  if (!id) return null;
  return index.byKey.get(id) || index.byAlias.get(id) || index.byCompact.get(compactKey(id)) || null;
}

// ---------------------------------------------------------------------------
// Parsing and expansion
// ---------------------------------------------------------------------------

/**
 * Splits what the user typed into key, args, query and hash.
 * Accepts "payroll", "go/payroll", "http://go/payroll/x?y=1", "jira ABC-1" (omnibox).
 */
export function parseInput(text, { shortHost = 'go' } = {}) {
  let s = String(text ?? '').trim();
  s = s.replace(new RegExp(`^(?:https?://)?${escapeRe(shortHost)}(?=/|$)`, 'i'), '');
  s = s.replace(/^\/+/, '');
  const m = s.match(/^([^/\s?#]*)([\s\S]*)$/);
  const rawKey = m[1];
  let tail = m[2];
  const out = { key: safeDecode(rawKey), args: [], star: '', query: '', hash: '', style: 'path' };
  if (/^\s/.test(tail)) {
    out.style = 'space';
    const rest = tail.trim();
    out.args = rest ? rest.split(/\s+/) : [];
    out.star = rest;
    return out;
  }
  const hi = tail.indexOf('#');
  if (hi >= 0) { out.hash = tail.slice(hi + 1); tail = tail.slice(0, hi); }
  const qi = tail.indexOf('?');
  if (qi >= 0) { out.query = tail.slice(qi + 1); tail = tail.slice(0, qi); }
  out.args = tail.split('/').filter(Boolean).map(safeDecode);
  out.star = out.args.join('/');
  return out;
}

const encodePath = (s) => String(s).split('/').map(encodeURIComponent).join('/');

function appendPath(url, segments) {
  if (!segments.length) return url;
  const extra = segments.map(encodeURIComponent).join('/');
  const cut = url.search(/[?#]/);
  const base = cut === -1 ? url : url.slice(0, cut);
  const tail = cut === -1 ? '' : url.slice(cut);
  return `${base.replace(/\/+$/, '')}/${extra}${tail}`;
}

function appendQuery(url, query) {
  if (!query) return url;
  const hi = url.indexOf('#');
  const base = hi === -1 ? url : url.slice(0, hi);
  const hash = hi === -1 ? '' : url.slice(hi);
  const sep = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&';
  return `${base}${sep}${query}${hash}`;
}

/** Removes leftovers of empty placeholders: empty params, doubled or trailing slashes. */
function tidy(url, template) {
  let u;
  try { u = new URL(url); } catch { return url; }
  const tplQuery = template.includes('?') ? template.slice(template.indexOf('?') + 1).split('#')[0] : '';
  const placeholderParams = new Set(tplQuery.split('&').filter((p) => /\{(\d+|\*)\}/.test(p)).map((p) => safeDecode(p.split('=')[0])));
  for (const name of placeholderParams) if (u.searchParams.get(name) === '') u.searchParams.delete(name);
  const tplPath = template.split(/[?#]/)[0];
  u.pathname = u.pathname.replace(/\/{2,}/g, '/');
  if (/\{(\d+|\*)\}\/?$/.test(tplPath) && u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  let out = u.toString();
  if (!u.search && out.includes('?')) out = out.replace('?', '');
  return out;
}

/** Builds the destination URL for a link and the parsed input. */
export function expand(link, parsed = {}) {
  const tpl = String(link.url);
  const args = parsed.args || [];
  const style = parsed.style || 'path';
  let url;
  if (isParameterised(tpl)) {
    if (!args.length && link.home) {
      url = link.home;
    } else {
      const nums = [...tpl.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).filter((p) => p !== '*').map(Number);
      const maxN = nums.length ? Math.max(...nums) : 0;
      const hasStar = /\{\*\}/.test(tpl);
      const qIndex = tpl.indexOf('?');
      const starText = maxN === 0 ? (parsed.star ?? args.join('/')) : args.slice(maxN).join(style === 'space' ? ' ' : '/');
      url = tpl.replace(PLACEHOLDER_RE, (_m, p, offset) => {
        const inQuery = qIndex !== -1 && offset > qIndex;
        if (p === '*') return inQuery ? encodeURIComponent(starText) : encodePath(starText);
        const v = args[Number(p) - 1];
        return v == null ? '' : encodeURIComponent(v);
      });
      if (!hasStar && args.length > maxN) url = appendPath(url, args.slice(maxN));
      if (args.length < maxN || (hasStar && !starText)) url = tidy(url, tpl);
    }
  } else {
    url = appendPath(tpl, args);
  }
  url = appendQuery(url, parsed.query);
  if (parsed.hash && !url.includes('#')) url += `#${parsed.hash}`;
  return url;
}

/**
 * Resolves typed text. Returns
 *   { link, url, parsed }                              when found
 *   { link: null, parsed, suggestions: [{link,score}] } when not found
 *   { empty: true, parsed }                              when there is no key
 */
export function resolve(index, text, opts = {}) {
  const parsed = parseInput(text, opts);
  if (!cleanKey(parsed.key)) return { empty: true, link: null, parsed, suggestions: [] };
  const link = lookup(index, parsed.key);
  if (link) return { link, url: expand(link, parsed), parsed };
  return { link: null, parsed, suggestions: suggest(index, parsed.key, opts) };
}

// ---------------------------------------------------------------------------
// Search and fuzzy suggestions
// ---------------------------------------------------------------------------

/** Optimal-string-alignment distance (Levenshtein + adjacent swaps). Stops early above `max`. */
export function levenshtein(a, b, max = Infinity) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Returns a gap penalty if every char of `needle` appears in order in `hay`, else -1. */
function subsequence(needle, hay) {
  let j = 0; let gaps = 0; let last = -1;
  for (let i = 0; i < hay.length && j < needle.length; i++) {
    if (hay[i] === needle[j]) { if (last !== -1) gaps += i - last - 1; last = i; j++; }
  }
  return j === needle.length ? gaps : -1;
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const typoBudget = (len) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

/** Score of one search term against one link (0 = no match). */
export function scoreTerm(link, term) {
  const t = term.toLowerCase();
  const tk = matchKey(t);
  if (!t) return 0;
  const key = link.id || matchKey(link.key);
  const aliases = link.aliasIds || (link.aliases || []).map(matchKey);
  let s = 0;
  const bump = (v) => { if (v > s) s = v; };
  if (tk) {
    if (key === tk) bump(1000);
    if (aliases.includes(tk)) bump(900);
    if (key.startsWith(tk)) bump(800 - (key.length - tk.length) * 4);
    for (const a of aliases) if (a.startsWith(tk)) bump(700 - (a.length - tk.length) * 4);
    if (tk.length >= 2 && key.includes(tk)) bump(520);
    for (const a of aliases) if (tk.length >= 2 && a.includes(tk)) bump(470);
  }
  const titleWords = words(link.title);
  if (titleWords.some((w) => w === t)) bump(460);
  else if (titleWords.some((w) => w.startsWith(t))) bump(420);
  else if (t.length >= 3 && String(link.title).toLowerCase().includes(t)) bump(320);
  for (const tag of link.tags || []) { if (tag === t) bump(380); else if (tag.startsWith(t)) bump(260); }
  const dept = String(link.department || '').toLowerCase();
  if (dept && dept === t) bump(300); else if (dept && t.length >= 2 && dept.startsWith(t)) bump(200);
  if (t.length >= 3 && words(link.description).some((w) => w.startsWith(t))) bump(140);
  if (s) return s;
  // fuzzy: typos (Levenshtein / adjacent swaps) on key and aliases, then subsequence
  const budget = typoBudget(tk.length);
  if (budget) {
    for (const [cand, base] of [[key, 640], ...aliases.map((a) => [a, 560])]) {
      const d = levenshtein(tk, cand, budget);
      if (d <= budget) bump(base - d * 140);
      // typo in a prefix: "payrol" vs "payroll-uk"
      if (cand.length > tk.length) {
        const dp = levenshtein(tk, cand.slice(0, tk.length), budget);
        if (dp <= budget) bump(base - 120 - dp * 140);
      }
    }
    for (const w of titleWords) { if (w.length >= 4 && levenshtein(t, w, budget) <= budget) bump(240); }
  }
  if (tk.length >= 2) {
    const gaps = subsequence(tk, key);
    if (gaps >= 0) bump(Math.max(60, 220 - gaps * 25));
  }
  return s;
}

/**
 * Ranks links for a free-text query.
 * opts: { limit, department, usage: { [id]: { count } }, includeAll (empty query lists everything) }
 */
export function search(index, query, opts = {}) {
  const { limit = 50, department, usage = {} } = opts;
  let q = String(query ?? '').trim().toLowerCase();
  q = q.replace(new RegExp(`^(?:https?://)?${escapeRe(opts.shortHost || 'go')}/`), '');
  const terms = q.split(/[\s/]+/).filter(Boolean);
  const pool = (index.links || []).filter((l) => !department || (l.department || 'Other') === department);
  const boost = (l) => (l.featured ? 15 : 0) + Math.min(60, 15 * Math.log2(1 + (usage[l.id]?.count || 0)));
  let results;
  if (!terms.length) {
    results = pool.map((link) => ({ link, score: boost(link) }));
  } else {
    results = [];
    for (const link of pool) {
      let total = 0;
      let ok = true;
      for (const term of terms) {
        const sc = scoreTerm(link, term);
        if (!sc) { ok = false; break; }
        total += sc;
      }
      if (ok) results.push({ link, score: total / terms.length + boost(link) });
    }
  }
  results.sort((a, b) => b.score - a.score || a.link.key.localeCompare(b.link.key));
  return results.slice(0, limit);
}

/** Suggestions for a key that does not exist. */
export function suggest(index, key, opts = {}) {
  const limit = opts.suggestLimit || 6;
  let res = search(index, key, { ...opts, limit });
  if (!res.length) {
    // fall back to splitting on separators: "hr-payroll" → "hr payroll"
    const spaced = cleanKey(key).replace(/[._-]+/g, ' ');
    if (spaced.includes(' ')) res = search(index, spaced.split(' ').sort((a, b) => b.length - a.length)[0], { ...opts, limit });
  }
  return res;
}

/** Groups links by department ("Other" when empty) → [{ name, count }] sorted by name. */
export function departments(links) {
  const counts = new Map();
  for (const l of links) {
    const d = l.department || 'Other';
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === 'Other') - (b.name === 'Other') || a.name.localeCompare(b.name));
}

/** The URL a card/anchor should open when no arguments are given. */
export function defaultUrl(link) {
  return expand(link, { args: [] });
}
