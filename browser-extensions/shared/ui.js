// DOM helpers, icon set, toasts and dialogs shared by every extension page.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Creates an element.  h('button', { class: 'btn', onclick }, icon('plus'), 'Add')
 * attrs: class, style (string|object), dataset (object), on<event> (function),
 *        html (innerHTML – trusted strings only), any other attribute.
 * Children: strings, numbers, nodes, arrays, null/false (skipped).
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string' && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  if (value !== undefined) el.value = value; // after children so <select> options exist
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Removes all children and appends new ones. */
export function render(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------------------------------------------------------------------------
// Icons (24×24, stroke-based). icon('search', { size: 16, class: '...' })
// ---------------------------------------------------------------------------
export const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3z"/>',
  'shield-check': '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  'shield-alert': '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3z"/><path d="M12 8.5v4M12 15.5h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.5"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  chart: '<path d="M3 20h18M6 16v-4M11 16V7M16 16v-6M21 16V4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'arrow-right': '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"/><path d="M14 3v5h5"/>',
  'file-text': '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  pen: '<path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/>',
  square: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  highlighter: '<path d="m9 15-4 4h5l2-2"/><path d="m14 4 6 6-8 8-6-6 8-8z"/>',
  redact: '<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 7v10M11 7v10M15 7v10M19 7v10" opacity=".5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  home: '<path d="M3 11 12 4l9 7M5 10v10h14V10"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  ticket: '<path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v2z"/><path d="M14 5v2M14 11v2M14 17v2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  power: '<path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18H7z"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4V3z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 11a14 14 0 0 1 11-8 14 14 0 0 1-8 11l-3-3z"/><circle cx="15" cy="9" r="1.5"/><path d="M9 11 5.5 10.5 8 7h4M13 15l.5 3.5L17 16v-4"/>',
  slash: '<path d="M16 4 8 20"/>',
};

export function icon(name, { size, class: cls, title } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', title ? 'false' : 'true');
  if (size) { svg.setAttribute('width', size); svg.setAttribute('height', size); }
  if (cls) svg.setAttribute('class', cls);
  svg.innerHTML = (title ? `<title>${escapeHtml(title)}</title>` : '') + (ICONS[name] || ICONS.info);
  return svg;
}

/** Replaces every <i data-icon="name"></i> placeholder in `root` with its SVG. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i[data-icon]')) {
    const svg = icon(el.dataset.icon, { size: el.dataset.size });
    if (el.className) svg.setAttribute('class', el.className);
    el.replaceWith(svg);
  }
}

// ---------------------------------------------------------------------------
// Feedback: toasts and dialogs
// ---------------------------------------------------------------------------
let toastStack;
/** toast('Saved', { tone: 'success'|'warning'|'danger'|'info', timeout: 3000 }) */
export function toast(message, { tone = 'info', timeout = 3200 } = {}) {
  if (!toastStack) {
    toastStack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastStack);
  }
  const name = { success: 'check', warning: 'alert', danger: 'alert', info: 'info' }[tone] || 'info';
  const el = h('div', { class: `toast ${tone}` }, icon(name), h('span', {}, message));
  toastStack.append(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, timeout);
  return el;
}

/**
 * Modal dialog. Resolves with the clicked action's value (or null on Escape).
 * dialog({ title, message | body:Node, tone, icon, wide, actions: [{ label, value, variant }] })
 */
export function dialog({ title, message, body, tone, icon: iconName, wide, actions }) {
  return new Promise((resolve) => {
    const toneIcon = iconName || { danger: 'alert', warning: 'alert', success: 'check' }[tone];
    const btns = (actions || [{ label: 'OK', value: true, variant: 'primary' }]).map((a) =>
      h('button', { class: `btn ${a.variant || ''}`, type: 'button', value: String(a.value), onclick: () => close(a.value) }, a.icon && icon(a.icon), a.label));
    const dlg = h('dialog', { class: `dialog${wide ? ' wide' : ''}` },
      h('div', { class: 'dialog-body' },
        h('h2', {}, toneIcon && icon(toneIcon, { class: tone ? `text-${tone}` : '' }), title),
        message && h('p', {}, message),
        body),
      h('div', { class: 'dialog-actions' }, btns));
    let done = false;
    function close(v) {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(v);
    }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dlg);
    dlg.showModal();
    (btns.find((b) => b.classList.contains('primary')) || btns.at(-1))?.focus();
  });
}

export async function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone }) {
  const v = await dialog({
    title, message, tone,
    actions: [
      { label: cancelLabel, value: false, variant: 'ghost' },
      { label: confirmLabel, value: true, variant: tone === 'danger' ? 'danger' : 'primary' },
    ],
  });
  return v === true;
}

/** Text prompt. Resolves with the entered string or null. */
export function promptDialog({ title, message, label, value = '', placeholder = '', confirmLabel = 'OK', validate }) {
  return new Promise((resolve) => {
    const input = h('input', { class: 'input', value, placeholder });
    const err = h('div', { class: 'error', hidden: true });
    const body = h('div', { class: 'field mt-12' }, label && h('label', {}, label), input, err);
    const dlg = h('dialog', { class: 'dialog' },
      h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('div', { class: 'dialog-body' }, h('h2', {}, title), message && h('p', {}, message), body),
        h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => finish(null) }, 'Cancel'),
          h('button', { class: 'btn primary', type: 'submit' }, confirmLabel))));
    function submit() {
      const problem = validate?.(input.value);
      if (problem) { err.textContent = problem; err.hidden = false; input.classList.add('invalid'); return; }
      finish(input.value);
    }
    function finish(v) { dlg.close(); dlg.remove(); resolve(v); }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    input.focus();
    input.select();
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    return ok;
  }
}

/** Triggers a file download from a string, Blob or object (serialised as JSON). */
export function downloadFile(filename, data, mime = 'application/json') {
  const blob = data instanceof Blob ? data
    : new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Opens a file picker and resolves with the chosen File (or null). */
export function pickFile(accept = '') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function readFile(file, as = 'text') {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    if (as === 'dataUrl') r.readAsDataURL(file); else r.readAsText(file);
  });
}

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;
/** "3 minutes ago", "yesterday", ... */
export function relativeTime(date) {
  const d = new Date(date).getTime();
  if (!d) return '';
  const diff = (d - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, secs] of units) {
    if (Math.abs(diff) >= secs) return rtf ? rtf.format(Math.round(diff / secs), unit) : new Date(d).toLocaleString();
  }
  return 'just now';
}

export function formatDateTime(date) {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatNumber(n) {
  return new Intl.NumberFormat().format(n ?? 0);
}

export function formatDuration(minutes) {
  const m = Math.round(minutes || 0);
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  return `${hrs}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Favicon URL for a domain (via the browser's own favicon cache when available). */
export function faviconFor(url, size = 32) {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    if (globalThis.chrome?.runtime?.getURL && !globalThis.browser) {
      return chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(u.origin)}&size=${size}`);
    }
    return `${u.origin}/favicon.ico`;
  } catch {
    return '';
  }
}

/** Makes table headers with data-sort="key" sortable. Calls onSort(key, dir). */
export function sortableHeaders(table, onSort, initial = { key: null, dir: 'desc' }) {
  let state = { ...initial };
  for (const th of table.querySelectorAll('th[data-sort]')) {
    th.classList.add('sortable');
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state = { key, dir: state.key === key && state.dir === 'desc' ? 'asc' : 'desc' };
      for (const o of table.querySelectorAll('th[data-sort]')) o.removeAttribute('aria-sort');
      th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
      onSort(state.key, state.dir);
    });
  }
}
