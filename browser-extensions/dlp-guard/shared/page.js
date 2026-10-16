// Page bootstrap for popups, options pages and full-page views.
//
//   const ctx = await initPage({ defaults: DEFAULTS, title: 'Ticket Snap' });
//
// - loads layered settings (see config.js) and applies the brand
// - renders the branded header into #app-header and footer into #app-footer
// - replaces <i data-icon="..."> placeholders with SVG icons
// - re-applies everything live when settings or policy change
// - on options pages (`options: true`) provides dirty tracking + a save bar

import { api } from './browser.js';
import { loadSettings, saveSettings, onSettingsChanged } from './config.js';
import { applyBrand, normalizeBrand, logoUrl, monogram } from './brand.js';
import { h, icon, hydrateIcons, toast } from './ui.js';

/** Renders the brand mark (logo image or monogram tile). */
export function brandMark(brand, { size } = {}) {
  const b = normalizeBrand(brand);
  const src = logoUrl(b);
  const el = h('span', { class: `brand-mark${src ? ' has-logo' : ''}`, style: size ? { width: `${size}px`, height: `${size}px` } : null });
  if (src) {
    const img = h('img', { src, alt: `${b.companyName} logo` });
    img.addEventListener('error', () => { el.classList.remove('has-logo'); el.replaceChildren(monogram(b.companyName)); });
    el.append(img);
  } else {
    el.append(monogram(b.companyName));
  }
  return el;
}

/** Fills a container with the branded app header. */
export function renderHeader(el, brand, { title, subtitle, actions = [] } = {}) {
  const b = normalizeBrand(brand);
  el.classList.add('app-header');
  el.replaceChildren(...[
    brandMark(b),
    h('div', { class: 'titles' },
      h('div', { class: 'company truncate' }, subtitle ?? b.companyName),
      h('div', { class: 'title truncate' }, title)),
    actions.length ? h('div', { class: 'actions' }, actions) : null,
  ].filter(Boolean));
  return el;
}

/** Fills a container with the branded footer (footer text + help link). */
export function renderFooter(el, brand, { extra } = {}) {
  const b = normalizeBrand(brand);
  el.classList.add('app-footer');
  const help = b.supportUrl
    ? h('a', { href: b.supportUrl, target: '_blank', rel: 'noopener' }, 'Get help')
    : b.supportEmail ? h('a', { href: `mailto:${b.supportEmail}` }, b.supportEmail) : null;
  el.replaceChildren(
    h('span', { class: 'truncate' }, b.footerText || b.companyName),
    h('span', { class: 'row gap-12' }, extra, help),
  );
  return el;
}

/**
 * @param {object} opts
 * @param {object} opts.defaults   extension default settings
 * @param {string} opts.title      page/product title shown in the header
 * @param {string} [opts.subtitle] small text above the title (defaults to company name)
 * @param {Node[]} [opts.headerActions]
 * @param {boolean} [opts.options] enable dirty tracking + save bar
 * @param {(ctx)=>void} [opts.onSettingsChange] called after settings change externally
 */
export async function initPage(opts = {}) {
  const { defaults = {}, title = '', subtitle, headerActions = [], options = false } = opts;
  const loaded = await loadSettings(defaults);

  const ctx = {
    api,
    ...loaded,
    get settings() { return this.values; },
    brand: normalizeBrand(loaded.values.brand),
    dirty: false,
    collectors: [],
    validators: [],
    afterSave: [],
    listeners: [],

    /** Saves top-level keys to the user layer and refreshes ctx. */
    async save(patch) {
      await saveSettings(patch);
      await ctx.reload();
    },
    async reload() {
      Object.assign(ctx, await loadSettings(defaults));
      ctx.brand = normalizeBrand(ctx.values.brand);
      return ctx;
    },
    onChange(cb) { ctx.listeners.push(cb); },
    /** Temporarily re-skins the page (live preview while editing the brand). */
    previewBrand(brand) { applyBrand(brand); paintChrome(normalizeBrand(brand)); },

    // ---- options-page helpers ----
    markDirty() { if (options) { ctx.dirty = true; saveBar?.show(); } },
    markClean() { ctx.dirty = false; saveBar?.hide(); },
    /** fn() => patch object (top-level keys) merged into the save. */
    registerCollector(fn) { ctx.collectors.push(fn); },
    /** fn(patch) => error string | null. */
    registerValidator(fn) { ctx.validators.push(fn); },
    onSaved(fn) { ctx.afterSave.push(fn); },
    async saveAll() {
      const patch = {};
      try {
        for (const c of ctx.collectors) Object.assign(patch, await c());
      } catch (err) {
        toast(err.message || String(err), { tone: 'danger', timeout: 5000 });
        return false;
      }
      for (const v of ctx.validators) {
        const problem = await v(patch);
        if (problem) { toast(problem, { tone: 'danger', timeout: 5000 }); return false; }
      }
      for (const key of Object.keys(patch)) if (ctx.locked.has(key)) delete patch[key];
      await ctx.save(patch);
      ctx.markClean();
      applyBrand(ctx.brand);
      paintChrome(ctx.brand);
      for (const fn of ctx.afterSave) await fn(ctx);
      toast('Settings saved', { tone: 'success' });
      return true;
    },
  };

  function paintChrome(brand) {
    const header = document.getElementById('app-header');
    if (header) renderHeader(header, brand, { title, subtitle, actions: headerActions });
    const footer = document.getElementById('app-footer');
    if (footer) renderFooter(footer, brand, { extra: opts.footerExtra?.() });
    if (title) document.title = `${title} · ${brand.companyName}`;
  }

  applyBrand(ctx.brand);
  paintChrome(ctx.brand);
  hydrateIcons(document);

  let saveBar;
  if (options) {
    saveBar = createSaveBar(ctx);
    window.addEventListener('beforeunload', (e) => { if (ctx.dirty) { e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (ctx.dirty) ctx.saveAll(); }
    });
  }

  onSettingsChanged(async () => {
    if (ctx.dirty) return; // don't clobber unsaved edits
    await ctx.reload();
    applyBrand(ctx.brand);
    paintChrome(ctx.brand);
    for (const cb of ctx.listeners) cb(ctx);
    opts.onSettingsChange?.(ctx);
  });

  document.documentElement.classList.add('ready');
  return ctx;
}

function createSaveBar(ctx) {
  const saveBtn = h('button', { class: 'btn primary sm', type: 'button', onclick: async () => {
    saveBtn.disabled = true;
    try { await ctx.saveAll(); } finally { saveBtn.disabled = false; }
  } }, icon('check'), 'Save changes');
  const bar = h('div', { class: 'save-bar', role: 'region', 'aria-label': 'Unsaved changes' },
    h('span', {}, 'You have unsaved changes'),
    h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { ctx.dirty = false; location.reload(); } }, 'Discard'),
    saveBtn);
  document.body.append(bar);
  return {
    show: () => bar.classList.add('visible'),
    hide: () => bar.classList.remove('visible'),
  };
}
