// Reusable building blocks for options pages: declarative field binding,
// the branding editor, import/export/policy tools and the About panel.

import { api, IS_FIREFOX, extVersion } from './browser.js';
import { replaceLocalSettings, readLocalSettings, isPlainObject } from './config.js';
import { BRAND_PRESETS, normalizeBrand, isHex, contrastText, logoUrl, monogram } from './brand.js';
import { h, icon, toast, confirmDialog, dialog, downloadFile, pickFile, readFile, copyText, $$ } from './ui.js';
import { getEnvironmentInfo } from './env-info.js';

/** Small "Managed" chip shown next to settings enforced by policy. */
export function lockChip() {
  return h('span', { class: 'lock-chip', title: 'Set by your organization. Contact IT to change it.' }, icon('lock'), 'Managed');
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function labelFor(el) {
  const row = el.closest('.setting-row');
  if (row) return row.querySelector('.text strong');
  const field = el.closest('.field');
  return field?.querySelector(':scope > label, :scope > .label');
}

/**
 * Two-way binds every [data-setting="key"] (or "key.sub") inside `root`.
 * data-type: bool | number | text (default) | lines | csv | json
 * (checkboxes default to bool, number inputs to number).
 * Registers a collector with ctx so the save bar persists the values.
 */
export function bindSettings(root, ctx) {
  const els = $$('[data-setting]', root);

  const typeOf = (el) => el.dataset.type || (el.type === 'checkbox' ? 'bool' : el.type === 'number' || el.type === 'range' ? 'number' : 'text');

  function write(el, value) {
    const t = typeOf(el);
    if (t === 'bool') el.checked = !!value;
    else if (t === 'lines') el.value = (value || []).join('\n');
    else if (t === 'csv') el.value = (value || []).join(', ');
    else if (t === 'json') el.value = value == null ? '' : JSON.stringify(value, null, 2);
    else el.value = value ?? '';
  }

  function read(el) {
    const t = typeOf(el);
    const v = el.value;
    if (t === 'bool') return el.checked;
    if (t === 'number') { const n = Number(v); return Number.isFinite(n) ? n : 0; }
    if (t === 'lines') return v.split('\n').map((s) => s.trim()).filter(Boolean);
    if (t === 'csv') return v.split(',').map((s) => s.trim()).filter(Boolean);
    if (t === 'json') {
      if (!v.trim()) return null;
      try { el.classList.remove('invalid'); return JSON.parse(v); } catch (err) {
        el.classList.add('invalid');
        const name = labelFor(el)?.textContent?.trim() || el.dataset.setting;
        throw new Error(`"${name}" is not valid JSON: ${err.message}`);
      }
    }
    return v;
  }

  function load() {
    for (const el of els) {
      const path = el.dataset.setting;
      write(el, getPath(ctx.settings, path));
      const locked = ctx.isLocked(path);
      el.disabled = locked;
      const label = labelFor(el);
      label?.querySelector('.lock-chip')?.remove();
      if (locked && label) label.append(' ', lockChip());
    }
  }

  for (const el of els) {
    el.addEventListener('input', () => ctx.markDirty());
    el.addEventListener('change', () => ctx.markDirty());
  }

  load();
  ctx.registerCollector(() => {
    const patch = {};
    for (const el of els) {
      const path = el.dataset.setting;
      if (ctx.isLocked(path)) continue;
      const value = read(el);
      const [top, sub] = path.split('.');
      if (sub) {
        patch[top] ??= isPlainObject(ctx.settings[top]) ? { ...ctx.settings[top] } : {};
        patch[top][sub] = value;
      } else {
        patch[top] = value;
      }
    }
    return patch;
  });
  ctx.onChange(load);
  return { reload: load, read, write };
}

/** Highlights the side-nav link of the section currently in view. */
export function initSideNav(nav = document.querySelector('.side-nav')) {
  if (!nav) return;
  const links = $$('a[href^="#"]', nav);
  const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const setActive = (id) => links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${id}`));
  const obs = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (visible[0]) setActive(visible[0].target.id);
  }, { rootMargin: '-10% 0px -70% 0px' });
  sections.forEach((s) => obs.observe(s));
  setActive((location.hash || `#${sections[0]?.id}`).slice(1));
}

/** Standard section header: icon + title + description. */
export function sectionHead(title, description, iconName) {
  return h('div', { class: 'section-head' },
    h('h2', {}, iconName && icon(iconName, { size: 20, class: 'text-primary' }), title),
    description && h('p', {}, description));
}

// ---------------------------------------------------------------------------
// Branding editor
// ---------------------------------------------------------------------------
const BRAND_KEYS = ['companyName', 'logo', 'primary', 'accent', 'theme', 'radius', 'supportUrl', 'supportEmail', 'footerText'];
const MAX_LOGO_BYTES = 300 * 1024;

/**
 * Full branding editor with live preview. Stores only the fields that differ
 * from the company brand kit/policy, so later kit updates still flow through.
 */
export function mountBrandingPanel(el, ctx) {
  const base = normalizeBrand(ctx.base.brand);
  let draft = normalizeBrand(ctx.settings.brand);
  const locked = (k) => ctx.isLocked(`brand.${k}`);

  const preview = h('div', { class: 'preview-frame' });
  const fields = {};

  function update(changes, { silent } = {}) {
    draft = normalizeBrand({ ...draft, ...changes });
    renderPreview();
    syncInputs();
    ctx.previewBrand(draft);
    if (!silent) ctx.markDirty();
  }

  // --- identity ---
  fields.companyName = h('input', { class: 'input', value: draft.companyName, maxlength: 60, oninput: (e) => update({ companyName: e.target.value }) });
  const logoBox = h('div', { class: 'row gap-12' });
  const drop = h('div', { class: 'dropzone grow', tabindex: 0, role: 'button' },
    icon('upload', { size: 18 }), h('div', { class: 'mt-4' }, h('strong', {}, 'Upload logo'), ' or drop an image here'),
    h('div', { class: 'subtle' }, 'SVG or PNG, square works best, up to 300 KB'));
  async function takeFile(file) {
    if (!file) return;
    if (!/^image\/(png|svg\+xml|jpeg|webp|gif)$/.test(file.type)) return toast('Please choose a PNG, SVG, JPEG, WebP or GIF image', { tone: 'warning' });
    if (file.size > MAX_LOGO_BYTES) return toast('That image is larger than 300 KB', { tone: 'warning' });
    update({ logo: await readFile(file, 'dataUrl') });
  }
  drop.addEventListener('click', async () => !locked('logo') && takeFile(await pickFile('image/*')));
  drop.addEventListener('keydown', async (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); !locked('logo') && takeFile(await pickFile('image/*')); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (!locked('logo')) takeFile(e.dataTransfer.files[0]); });
  const logoThumb = h('div', { class: 'brand-mark', style: { width: '64px', height: '64px', fontSize: '22px', borderRadius: 'var(--radius)' } });
  const logoActions = h('div', { class: 'col gap-4' },
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => update({ logo: base.logo }) }, icon('refresh'), 'Company logo'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => update({ logo: '' }) }, icon('x'), 'Use initials'));
  logoBox.append(logoThumb, drop, logoActions);

  // --- colours ---
  const swatches = h('div', { class: 'swatches' }, BRAND_PRESETS.map((p) =>
    h('button', {
      class: 'swatch', type: 'button', title: p.name, 'aria-label': `${p.name} preset`,
      style: { background: p.primary },
      onclick: () => !locked('primary') && update({ primary: p.primary, accent: locked('accent') ? draft.accent : p.accent }),
    })));
  BRAND_PRESETS.forEach((p, i) => swatches.children[i].style.setProperty('--sw-accent', p.accent));

  const colorInput = (key) => {
    const picker = h('input', { type: 'color', class: 'swatch-input', value: draft[key], oninput: (e) => update({ [key]: e.target.value.toUpperCase() }) });
    const hex = h('input', { class: 'input code', value: draft[key], maxlength: 7, style: { width: '110px' },
      oninput: (e) => { const v = e.target.value.trim(); if (isHex(v)) update({ [key]: v.toUpperCase() }); } });
    fields[key] = { picker, hex };
    return h('div', { class: 'row' }, picker, hex);
  };
  const contrastNote = h('div', { class: 'help' });

  // --- appearance ---
  const themeSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Theme' },
    [['auto', 'Auto', 'sparkle'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']].map(([v, label, ic]) =>
      h('button', { type: 'button', 'aria-pressed': String(draft.theme === v), dataset: { v }, onclick: () => !locked('theme') && update({ theme: v }) }, icon(ic), label)));
  fields.radius = h('input', { type: 'range', min: 0, max: 20, step: 1, value: draft.radius, oninput: (e) => update({ radius: Number(e.target.value) }) });
  const radiusLabel = h('span', { class: 'badge' });

  // --- support ---
  fields.supportUrl = h('input', { class: 'input', type: 'url', placeholder: 'https://intranet.example.com/help', value: draft.supportUrl, oninput: (e) => update({ supportUrl: e.target.value.trim() }) });
  fields.supportEmail = h('input', { class: 'input', type: 'email', placeholder: 'it-help@example.com', value: draft.supportEmail, oninput: (e) => update({ supportEmail: e.target.value.trim() }) });
  fields.footerText = h('input', { class: 'input', placeholder: 'Managed by Example IT', value: draft.footerText, maxlength: 80, oninput: (e) => update({ footerText: e.target.value }) });

  const field = (label, control, help, key) => h('div', { class: 'field' },
    h('label', {}, label, key && locked(key) ? [' ', lockChip()] : null), control, help && h('div', { class: 'help' }, help));

  function syncInputs() {
    if (document.activeElement !== fields.companyName) fields.companyName.value = draft.companyName;
    for (const k of ['primary', 'accent']) {
      fields[k].picker.value = draft[k].length === 4 ? '#' + draft[k].slice(1).split('').map((c) => c + c).join('') : draft[k];
      if (document.activeElement !== fields[k].hex) fields[k].hex.value = draft[k];
    }
    for (const b of themeSeg.children) b.setAttribute('aria-pressed', String(b.dataset.v === draft.theme));
    fields.radius.value = draft.radius;
    radiusLabel.textContent = `${draft.radius}px`;
    for (const k of ['supportUrl', 'supportEmail', 'footerText']) if (document.activeElement !== fields[k]) fields[k].value = draft[k];
    const src = logoUrl(draft);
    logoThumb.classList.toggle('has-logo', !!src);
    logoThumb.replaceChildren(src ? h('img', { src, alt: '' }) : monogram(draft.companyName));
    const onP = contrastText(draft.primary);
    contrastNote.textContent = `Buttons use ${onP === '#FFFFFF' ? 'white' : 'dark'} text on your primary colour for readability.`;
    // locks
    fields.companyName.disabled = locked('companyName');
    for (const k of ['primary', 'accent']) { fields[k].picker.disabled = fields[k].hex.disabled = locked(k); }
    fields.radius.disabled = locked('radius');
    for (const k of ['supportUrl', 'supportEmail', 'footerText']) fields[k].disabled = locked(k);
    drop.classList.toggle('hidden', locked('logo'));
    logoActions.classList.toggle('hidden', locked('logo'));
  }

  function renderPreview() {
    const vars = {
      '--brand-primary': draft.primary, '--brand-on-primary': contrastText(draft.primary),
      '--brand-accent': draft.accent, '--brand-on-accent': contrastText(draft.accent),
      '--radius': `${draft.radius}px`, '--radius-sm': `${Math.max(2, Math.round(draft.radius * 0.6))}px`, '--radius-lg': `${Math.round(draft.radius * 1.4)}px`,
    };
    const theme = draft.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : draft.theme;
    const src = logoUrl(draft);
    const mark = h('span', { class: `brand-mark${src ? ' has-logo' : ''}`, style: { width: '30px', height: '30px' } }, src ? h('img', { src, alt: '' }) : monogram(draft.companyName));
    const frame = h('div', { 'data-theme': theme, style: { ...vars, background: 'var(--surface)', color: 'var(--text)' } },
      h('div', { class: 'app-header', style: { padding: '12px 14px' } }, mark,
        h('div', { class: 'titles' }, h('div', { class: 'company truncate' }, draft.companyName || 'Company'), h('div', { class: 'title', style: { fontSize: '14.5px' } }, 'Preview'))),
      h('div', { style: { padding: '14px', background: 'var(--bg)' }, class: 'stack' },
        h('div', { class: 'card tight' },
          h('div', { class: 'row between' }, h('strong', {}, 'Everything looks good'), h('span', { class: 'badge primary' }, 'Active')),
          h('p', { class: 'subtle mt-4' }, 'This is how your extensions will look.'),
          h('div', { class: 'bar mt-8' }, h('span', { style: { width: '64%' } }))),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary sm', type: 'button', tabindex: -1 }, icon('check'), 'Primary'),
          h('button', { class: 'btn accent sm', type: 'button', tabindex: -1 }, 'Accent'),
          h('button', { class: 'btn soft sm', type: 'button', tabindex: -1 }, 'Soft'))),
      h('div', { class: 'app-footer', style: { borderTop: '1px solid var(--border)', background: 'var(--surface-2)', padding: '8px 14px' } },
        h('span', { class: 'truncate' }, draft.footerText || draft.companyName), draft.supportUrl || draft.supportEmail ? h('a', { href: '#', onclick: (e) => e.preventDefault() }, 'Get help') : null));
    preview.replaceChildren(frame);
  }

  async function exportKit() {
    const kit = {};
    for (const k of BRAND_KEYS) kit[k] = draft[k];
    downloadFile(`${(draft.companyName || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-brand.json`, kit);
  }
  async function importKit() {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const kit = JSON.parse(await readFile(file));
      if (!isPlainObject(kit)) throw new Error('not an object');
      const changes = {};
      for (const k of BRAND_KEYS) if (k in kit && !locked(k)) changes[k] = kit[k];
      update(changes);
      toast('Brand kit loaded. Save to keep it.', { tone: 'success' });
    } catch (err) {
      toast(`Could not read brand kit: ${err.message}`, { tone: 'danger' });
    }
  }

  el.replaceChildren(
    h('div', { class: 'grid-2', style: { alignItems: 'start', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)' } },
      h('div', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, icon('building', { size: 18 }), 'Identity')),
          field('Company name', fields.companyName, null, 'companyName'),
          field('Logo', logoBox, null, 'logo')),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, icon('palette', { size: 18 }), 'Colours')),
          field('Presets', swatches),
          h('div', { class: 'grid-2 mt-12' },
            field('Primary', colorInput('primary'), 'Buttons, highlights, icons', 'primary'),
            field('Accent', colorInput('accent'), 'Gradients and secondary actions', 'accent')),
          contrastNote),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, icon('sparkle', { size: 18 }), 'Appearance')),
          field('Theme', themeSeg, 'Auto follows the operating system setting.', 'theme'),
          field(h('span', { class: 'row' }, 'Corner roundness ', radiusLabel), fields.radius, null, 'radius')),
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h3', {}, icon('help', { size: 18 }), 'Support')),
          h('div', { class: 'grid-2' },
            field('Help page URL', fields.supportUrl, null, 'supportUrl'),
            field('Support email', fields.supportEmail, null, 'supportEmail')),
          field('Footer text', fields.footerText, null, 'footerText'))),
      h('div', { class: 'stack', style: { position: 'sticky', top: '20px' } },
        h('h4', {}, 'Live preview'),
        preview,
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn sm', type: 'button', onclick: exportKit }, icon('download'), 'Export brand kit'),
          h('button', { class: 'btn sm', type: 'button', onclick: importKit }, icon('upload'), 'Import brand kit'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
            const reset = {};
            for (const k of BRAND_KEYS) if (!locked(k)) reset[k] = base[k];
            update(reset);
          } }, icon('refresh'), 'Reset to company default')),
        h('p', { class: 'subtle' }, 'A brand kit exported here can be dropped into ', h('code', {}, 'brand/brand.json'), ' to bake it into every extension at build time, or pushed by IT through policy.'))),
  );

  syncInputs();
  renderPreview();

  ctx.registerCollector(() => {
    const overrides = {};
    for (const k of BRAND_KEYS) if (!locked(k) && draft[k] !== base[k]) overrides[k] = draft[k];
    return { brand: Object.keys(overrides).length ? overrides : undefined };
  });
  ctx.onChange(() => { draft = normalizeBrand(ctx.settings.brand); syncInputs(); renderPreview(); });
}

// ---------------------------------------------------------------------------
// Import / export / reset / policy
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string[]} [opts.secretKeys]  top-level keys never exported (API tokens etc.)
 * @param {string}   opts.slug          file-name prefix, e.g. "ticket-snap"
 */
export function mountBackupPanel(el, ctx, { secretKeys = [], slug = 'extension' } = {}) {
  const stripSecrets = (obj) => {
    const out = JSON.parse(JSON.stringify(obj));
    for (const k of secretKeys) delete out[k];
    return out;
  };

  async function exportSettings() {
    const local = await readLocalSettings();
    downloadFile(`${slug}-settings-${new Date().toISOString().slice(0, 10)}.json`, { exportedFrom: slug, version: extVersion(), settings: stripSecrets(local) });
    toast('Settings exported', { tone: 'success' });
  }

  async function importSettings() {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(file));
      if (!isPlainObject(parsed)) throw new Error('expected a JSON object');
    } catch (err) {
      return toast(`Could not read file: ${err.message}`, { tone: 'danger' });
    }
    const incoming = isPlainObject(parsed.settings) ? parsed.settings : parsed;
    if (parsed.exportedFrom && parsed.exportedFrom !== slug) {
      const go = await confirmDialog({ title: 'Different extension', message: `This file was exported from "${parsed.exportedFrom}". Import it anyway?`, confirmLabel: 'Import' });
      if (!go) return;
    }
    const ok = await confirmDialog({ title: 'Replace your settings?', message: 'Imported settings replace your current personal settings. Settings managed by your organization are not affected.', confirmLabel: 'Import settings' });
    if (!ok) return;
    const current = await readLocalSettings();
    const keep = {};
    for (const k of secretKeys) if (k in current) keep[k] = current[k];
    await replaceLocalSettings({ ...incoming, ...keep });
    ctx.dirty = false;
    location.reload();
  }

  async function resetAll() {
    const ok = await confirmDialog({ title: 'Reset all settings?', message: 'Your personal settings and branding changes will be removed and the company defaults restored.', confirmLabel: 'Reset everything', tone: 'danger' });
    if (!ok) return;
    await replaceLocalSettings({});
    ctx.dirty = false;
    location.reload();
  }

  async function showPolicy() {
    const local = stripSecrets(await readLocalSettings());
    const effective = stripSecrets(ctx.settings);
    const id = api.runtime.id;
    const payload = Object.keys(local).length ? local : effective;
    const chrome = { '3rdparty': { extensions: { [id]: payload } } };
    const firefox = { policies: { '3rdparty': { Extensions: { [id]: payload } } } };
    const text = (o) => JSON.stringify(o, null, 2);
    const pre = h('pre', { class: 'textarea code', style: { maxHeight: '320px', overflow: 'auto', whiteSpace: 'pre', margin: 0 } });
    const tabs = h('div', { class: 'segmented' });
    const variants = IS_FIREFOX
      ? [['Firefox policies.json', firefox]]
      : [['Chrome / Edge (JSON)', chrome], ['Firefox policies.json', firefox]];
    let current = variants[0][1];
    variants.forEach(([label, obj], i) => tabs.append(h('button', { type: 'button', 'aria-pressed': String(i === 0), onclick: (e) => {
      for (const b of tabs.children) b.setAttribute('aria-pressed', 'false');
      e.currentTarget.setAttribute('aria-pressed', 'true');
      current = obj; pre.textContent = text(obj);
    } }, label)));
    pre.textContent = text(current);
    const res = await dialog({
      title: 'Deploy these settings with policy', wide: true, icon: 'server',
      body: h('div', { class: 'stack' },
        h('p', { class: 'muted' }, 'Push the settings below to every device. Keys inside ', h('code', {}, 'defaults'), ' are suggestions users can change; every other key is enforced and locked. The extension ID on another browser or store listing can differ, so check it before you deploy.'),
        tabs, pre,
        h('p', { class: 'subtle' }, 'See examples/policies in the repository for Windows registry, macOS and Linux file locations.')),
      actions: [
        { label: 'Close', value: 'close', variant: 'ghost' },
        { label: 'Copy JSON', value: 'copy', variant: 'primary', icon: 'copy' },
      ],
    });
    if (res === 'copy') { await copyText(text(current)); toast('Policy JSON copied', { tone: 'success' }); }
  }

  el.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'setting-row' },
      h('div', { class: 'text' }, h('strong', {}, 'Export settings'), h('span', {}, `Download your settings as JSON.${secretKeys.length ? ' Secrets such as API tokens are left out.' : ''}`)),
      h('div', { class: 'control' }, h('button', { class: 'btn', type: 'button', onclick: exportSettings }, icon('download'), 'Export'))),
    h('div', { class: 'setting-row' },
      h('div', { class: 'text' }, h('strong', {}, 'Import settings'), h('span', {}, 'Load settings from a file exported from this extension.')),
      h('div', { class: 'control' }, h('button', { class: 'btn', type: 'button', onclick: importSettings }, icon('upload'), 'Import'))),
    h('div', { class: 'setting-row' },
      h('div', { class: 'text' }, h('strong', {}, 'Deploy to your organization'), h('span', {}, 'Turn the current configuration into a managed policy for Chrome, Edge or Firefox.')),
      h('div', { class: 'control' }, h('button', { class: 'btn', type: 'button', onclick: showPolicy }, icon('server'), 'Generate policy'))),
    h('div', { class: 'setting-row' },
      h('div', { class: 'text' }, h('strong', {}, 'Reset to defaults'), h('span', {}, 'Remove all personal settings and branding changes.')),
      h('div', { class: 'control' }, h('button', { class: 'btn danger-soft', type: 'button', onclick: resetAll }, icon('refresh'), 'Reset'))),
  ));
}

/** Version, environment and policy status. */
export async function mountAboutPanel(el, ctx, { description = '', privacy = '' } = {}) {
  const env = await getEnvironmentInfo();
  const enforced = [...ctx.locked];
  el.replaceChildren(h('div', { class: 'card' },
    description && h('p', { class: 'muted', style: { marginBottom: '14px' } }, description),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Version'), h('dd', {}, extVersion()),
      h('dt', {}, 'Browser'), h('dd', {}, env.summary),
      h('dt', {}, 'Extension ID'), h('dd', { class: 'mono' }, api.runtime.id),
      h('dt', {}, 'Policy'), h('dd', {}, enforced.length
        ? h('span', { class: 'badge primary' }, icon('lock'), `${enforced.length} setting${enforced.length > 1 ? 's' : ''} managed by your organization`)
        : h('span', { class: 'badge' }, 'No managed policy')),
      ctx.brand.supportUrl || ctx.brand.supportEmail ? [h('dt', {}, 'Support'), h('dd', {},
        ctx.brand.supportUrl ? h('a', { href: ctx.brand.supportUrl, target: '_blank', rel: 'noopener' }, ctx.brand.supportUrl) : null,
        ctx.brand.supportUrl && ctx.brand.supportEmail ? ' · ' : null,
        ctx.brand.supportEmail ? h('a', { href: `mailto:${ctx.brand.supportEmail}` }, ctx.brand.supportEmail) : null)] : null),
    privacy && h('div', { class: 'callout mt-16' }, icon('shield'), h('div', {}, h('strong', {}, 'Privacy. '), privacy)),
  ));
}
