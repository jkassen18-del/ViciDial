// UI building blocks shared by the popup, directory, not-found page and options page.

import { h, icon, toast, copyText, faviconFor } from './shared/ui.js';
import { send } from './shared/messaging.js';
import * as R from './resolver.js';

/** Stable hue for a department name so its badge colour is the same everywhere. */
export function deptHue(name) {
  const s = String(name || 'Other');
  const named = { hr: 330, it: 210, marketing: 280, sales: 150, finance: 40, engineering: 190, facilities: 20, company: 245, legal: 0, design: 300, support: 170, operations: 100 };
  const k = s.toLowerCase();
  if (k in named) return named[k];
  let x = 0;
  for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360;
  return x;
}

export function deptBadge(name, { small } = {}) {
  if (!name) return null;
  return h('span', { class: `badge dept${small ? ' sm' : ''}`, style: `--h:${deptHue(name)}` }, name);
}

/** Favicon tile: department-tinted square with the site icon, falling back to an initial. */
export function linkIcon(link, { size = 34 } = {}) {
  const tile = h('span', { class: 'link-icon', style: `--h:${deptHue(link.department)};width:${size}px;height:${size}px`, 'aria-hidden': 'true' });
  const letter = (link.title || link.key || '?').trim().charAt(0).toUpperCase();
  const src = faviconFor(R.defaultUrl(link), size > 30 ? 32 : 16);
  if (src) {
    const img = h('img', { src, alt: '', referrerpolicy: 'no-referrer', width: Math.round(size * 0.55), height: Math.round(size * 0.55) });
    img.addEventListener('error', () => { tile.replaceChildren(letter); tile.classList.add('letter'); });
    tile.append(img);
  } else {
    tile.append(letter);
    tile.classList.add('letter');
  }
  return tile;
}

export function goLabel(key, shortHost = 'go') {
  return h('span', { class: 'go-key' }, h('span', { class: 'go-prefix' }, `${shortHost}/`), key);
}

export async function copyGoLink(link, shortHost = 'go') {
  const text = `${shortHost}/${link.key}`;
  const ok = await copyText(text);
  toast(ok ? `Copied ${text}` : 'Could not copy', { tone: ok ? 'success' : 'danger', timeout: 1800 });
}

export function copyButton(link, shortHost, { label } = {}) {
  return h('button', {
    class: `btn ghost sm${label ? '' : ' icon'}`, type: 'button', title: `Copy ${shortHost}/${link.key}`, 'aria-label': `Copy ${shortHost}/${link.key}`,
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); copyGoLink(link, shortHost); },
  }, icon('copy'), label);
}

/** Records a use without blocking navigation. */
export function recordUse(link) {
  send('recordUse', { key: link.key }).catch(() => {});
}

/**
 * Directory-style card. opts: { shortHost, newTab, onEdit, featured }
 */
export function linkCard(link, opts = {}) {
  const { shortHost = 'go', newTab = false } = opts;
  const href = R.defaultUrl(link);
  const aliases = link.activeAliases || link.aliases || [];
  const card = h('a', {
    class: `link-card${opts.featured ? ' featured' : ''}`, href, target: newTab ? '_blank' : '_self', rel: 'noopener',
    onclick: () => recordUse(link),
  },
  h('div', { class: 'lc-top' },
    linkIcon(link, { size: opts.featured ? 40 : 36 }),
    h('div', { class: 'lc-head' },
      h('div', { class: 'lc-title' }, link.title),
      h('div', { class: 'lc-key' }, goLabel(link.key, shortHost), R.isParameterised(link.url) ? h('span', { class: 'param-hint', title: 'Accepts extra path segments, e.g. go/' + link.key + '/…' }, '/…') : null)),
    h('div', { class: 'lc-actions' },
      opts.onEdit ? h('button', { class: 'btn ghost sm icon', type: 'button', title: 'Edit', 'aria-label': `Edit go/${link.key}`, onclick: (e) => { e.preventDefault(); e.stopPropagation(); opts.onEdit(link); } }, icon('edit')) : null,
      copyButton(link, shortHost))),
  link.description ? h('p', { class: 'lc-desc' }, link.description) : null,
  h('div', { class: 'lc-meta' },
    link.personal ? h('span', { class: 'badge info sm' }, icon('user'), 'Mine') : deptBadge(link.department, { small: true }),
    link.featured ? h('span', { class: 'badge sm warning' }, icon('star'), 'Start here') : null,
    ...(link.tags || []).slice(0, 3).map((t) => h('span', { class: 'tag' }, `#${t}`)),
    aliases.length ? h('span', { class: 'aliases', title: aliases.map((a) => `${shortHost}/${a}`).join(', ') }, `also ${aliases.slice(0, 2).map((a) => `${shortHost}/${a}`).join(', ')}${aliases.length > 2 ? ` +${aliases.length - 2}` : ''}`) : null));
  return card;
}

/** Compact list row used by the popup and suggestion lists. */
export function linkRow(link, opts = {}) {
  const { shortHost = 'go' } = opts;
  return h('div', {
    class: 'list-item link-row', role: 'option', tabindex: -1, dataset: { key: link.key },
    onclick: (e) => opts.onOpen?.(link, e),
    onauxclick: (e) => { if (e.button === 1) opts.onOpen?.(link, { ...e, newTab: true }); },
  },
  linkIcon(link, { size: 32 }),
  h('div', { class: 'li-main' },
    h('div', { class: 'li-title' }, link.title),
    h('div', { class: 'li-sub' }, goLabel(link.key, shortHost), link.description ? h('span', { class: 'li-desc' }, link.description) : null)),
  h('div', { class: 'li-meta' },
    link.personal ? h('span', { class: 'badge info sm' }, 'Mine') : deptBadge(link.department, { small: true }),
    copyButton(link, shortHost)));
}

// ---------------------------------------------------------------------------
// Personal link form
// ---------------------------------------------------------------------------

/**
 * Builds the fields for creating/editing a personal link.
 * Returns { el, read(), validate(), focus() }.
 * opts: { link, shortHost, isTaken(key) => string|null }
 */
export function personalLinkFields(opts = {}) {
  const l = opts.link || {};
  const shortHost = opts.shortHost || 'go';
  const key = h('input', { class: 'input', value: l.key || '', placeholder: 'standup', maxlength: 64, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Short name' });
  const url = h('input', { class: 'input', type: 'url', value: l.url || '', placeholder: 'https://…', 'aria-label': 'Destination URL' });
  const title = h('input', { class: 'input', value: l.title || '', placeholder: 'Daily standup call', maxlength: 120, 'aria-label': 'Title' });
  const description = h('input', { class: 'input', value: l.description || '', placeholder: 'Optional', maxlength: 240, 'aria-label': 'Description' });
  const err = h('div', { class: 'error', hidden: true, role: 'alert' });
  const keyHelp = h('div', { class: 'help' }, 'Letters, numbers, dots and dashes. Use {1} or {*} in the URL for parameters.');

  const field = (label, control, help) => h('div', { class: 'field' }, h('label', {}, label), control, help);
  const el = h('div', { class: 'link-fields' },
    field('Short name', h('div', { class: 'input-prefix' }, h('span', {}, `${shortHost}/`), key), keyHelp),
    field('Destination URL', url),
    h('div', { class: 'grid-2' }, field('Title', title), field('Description', description)),
    err);

  key.addEventListener('input', () => {
    const cleaned = R.cleanKey(key.value.replace(/\s/g, '-'));
    if (key.value && cleaned !== key.value.toLowerCase()) keyHelp.textContent = `Will be saved as ${shortHost}/${cleaned}`;
    else keyHelp.textContent = 'Letters, numbers, dots and dashes. Use {1} or {*} in the URL for parameters.';
    showError('');
  });
  url.addEventListener('input', () => showError(''));

  function showError(msg) {
    err.textContent = msg; err.hidden = !msg;
  }
  function read() {
    return { key: R.cleanKey(key.value), url: url.value.trim(), title: title.value.trim(), description: description.value.trim() };
  }
  function validate() {
    const v = read();
    let msg = '';
    if (!v.key) msg = 'Give the link a short name.';
    else if (!R.isValidKey(v.key)) msg = 'The short name can only use letters, numbers, dots and dashes.';
    else if (!R.isSafeUrl(v.url)) msg = 'Enter a destination starting with https:// or http://';
    else msg = opts.isTaken?.(v.key) || '';
    showError(msg);
    return msg ? null : v;
  }
  return { el, read, validate, showError, focus: () => (key.value ? url.value ? title : url : key).focus(), inputs: { key, url, title, description } };
}

/** Modal editor for a personal link. Resolves with the saved link or null. */
export function editPersonalLink({ link, shortHost = 'go', companyLookup, existingKeys = [], prefill, save } = {}) {
  const isTaken = (k) => {
    const id = R.matchKey(k);
    if (link && R.matchKey(link.key) === id) return null;
    const c = companyLookup?.(k);
    if (c) return `${shortHost}/${k} is already a company link (${c.title}). Pick another name.`;
    if (existingKeys.some((e) => R.matchKey(e) === id)) return `You already have ${shortHost}/${k}.`;
    return null;
  };
  const fields = personalLinkFields({ link: link || prefill, shortHost, isTaken });
  return new Promise((resolve) => {
    const saveBtn = h('button', { class: 'btn primary', type: 'submit' }, icon('check'), link ? 'Save' : 'Create link');
    const dlg = h('dialog', { class: 'dialog wide' },
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        const v = fields.validate();
        if (!v) return;
        saveBtn.disabled = true;
        try {
          if (save) await save(v, link);
          else await send('savePersonalLink', { link: v, originalKey: link?.key });
          finish(v);
        } catch (err) {
          fields.showError(err.message);
        } finally { saveBtn.disabled = false; }
      } },
      h('div', { class: 'dialog-body' },
        h('h2', {}, icon('link', { class: 'text-primary' }), link ? `Edit ${shortHost}/${link.key}` : 'New personal link'),
        h('p', {}, 'Personal links only exist in this browser. Company links always take priority.'),
        h('div', { class: 'mt-16' }, fields.el)),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => finish(null) }, 'Cancel'),
        saveBtn)));
    let done = false;
    function finish(v) { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(v); }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    fields.focus();
  });
}
