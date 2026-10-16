// Ticket Snap annotator: screenshot editor (left) + ticket form (right).
import { initPage } from './shared/page.js';
import { api, extVersion, openOptions } from './shared/browser.js';
import { ensureHostPermission } from './shared/config.js';
import { getEnvironmentInfo } from './shared/env-info.js';
import { h, $, icon, toast, copyText, downloadFile, pickFile, readFile } from './shared/ui.js';
import { DEFAULTS, PRIORITIES, PRIORITY_LABELS } from './defaults.js';
import { Editor, TOOLS, SIZES } from './lib/editor.js';
import { getCapture, removeCapture } from './lib/capture-store.js';
import { collectDiagnostics, filterDiagnostics, DIAGNOSTIC_ITEMS } from './lib/diagnostics.js';
import { detailsText, diagnosticEntries } from './lib/ticket-text.js';
import { getProvider, providerProblems, providerTarget } from './providers/index.js';
import { screenshotName, hostOf } from './providers/common.js';
import { addHistory } from './lib/history.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PRIORITY_COLORS = { low: '#94A3B8', normal: '#3B82F6', high: '#F59E0B', urgent: '#EF4444' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOOL_HINTS = {
  select: 'Click an annotation to select it, drag to move, Delete to remove. Double-click text to edit.',
  pen: 'Draw freehand.',
  highlighter: 'Drag over text to highlight it.',
  arrow: 'Drag to draw an arrow. Hold Shift to snap to 45°.',
  rect: 'Drag to draw a box. Hold Shift for a square.',
  ellipse: 'Drag to draw an ellipse. Hold Shift for a circle.',
  text: 'Click where the text should go. Enter to finish, Shift+Enter for a new line.',
  redact: 'Drag over anything private. Redactions are burned into the image and cannot be undone by IT.',
  crop: 'Drag to keep only part of the screenshot.',
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const captureId = new URLSearchParams(location.search).get('id');
const providerChip = h('span', { class: 'badge', title: 'Where tickets are sent' });
const settingsBtn = h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Ticket Snap settings', 'aria-label': 'Settings', onclick: () => openOptions() }, icon('settings'));

const [ctx, capture, env] = await Promise.all([
  initPage({ defaults: DEFAULTS, title: 'Report a problem', headerActions: [providerChip, settingsBtn] }),
  captureId ? getCapture(captureId).catch(() => null) : null,
  getEnvironmentInfo().catch(() => ({})),
]);

const captureContext = capture?.context || { capturedAt: new Date().toISOString() };
const fullDiagnostics = collectDiagnostics(captureContext, env, extVersion());

const state = {
  hasImage: false,
  imageSource: '',
  includeScreenshot: true,
  includeUrl: true,
  priority: ctx.settings.defaultPriority || 'normal',
  busy: false,
  submitted: false,
  dirty: false,
};

const editor = new Editor($('#canvas'), { onChange: () => { state.dirty = true; syncToolbar(); } });
editor.color = '#EF4444';

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
function selectIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M5 3.5 18.5 10l-6 1.8-2.3 6.2L5 3.5z');
  svg.append(path);
  return svg;
}

const toolButtons = {};
const rail = $('#tool-rail');
for (const t of TOOLS) {
  toolButtons[t.id] = h('button', {
    class: 'tool-btn', type: 'button', title: `${t.label} (${t.key})`, 'aria-label': `${t.label} (${t.key})`, 'aria-pressed': 'false',
    onclick: () => setTool(t.id),
  }, t.icon ? icon(t.icon) : selectIcon(), h('span', { class: 'k', 'aria-hidden': 'true' }, t.key));
  rail.append(toolButtons[t.id]);
  if (t.id === 'select' || t.id === 'text') rail.append(h('div', { class: 'rail-sep' }));
}
rail.append(h('div', { class: 'rail-sep' }));
const undoBtn = h('button', { class: 'tool-btn', type: 'button', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => editor.undo() }, icon('undo'));
const redoBtn = h('button', { class: 'tool-btn', type: 'button', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', onclick: () => editor.redo() }, icon('redo'));
const clearBtn = h('button', { class: 'tool-btn danger', type: 'button', title: 'Clear all annotations', 'aria-label': 'Clear all annotations', onclick: () => editor.clear() }, icon('trash'));
rail.append(undoBtn, redoBtn, clearBtn);

function paletteColors() {
  const brand = ctx.brand.primary.toUpperCase();
  const base = [['Red', '#EF4444'], ['Amber', '#F59E0B'], ['Green', '#22C55E'], ['Blue', '#3B82F6'], ['Black', '#111827'], ['White', '#FFFFFF']];
  return [['Brand', brand], ...base.filter(([, c]) => c !== brand)];
}
const palette = h('div', { class: 'palette', role: 'group', 'aria-label': 'Colour' });
function renderPalette() {
  palette.replaceChildren(...paletteColors().map(([name, c]) => h('button', {
    class: 'color-btn', type: 'button', title: name, 'aria-label': `${name} colour`, 'aria-pressed': String(editor.color === c),
    style: { background: c }, dataset: { color: c },
    onclick: () => { editor.setColor(c); syncToolbar(); },
  })));
}
const sizeSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Stroke width' },
  Object.keys(SIZES).map((k, i) => h('button', {
    type: 'button', title: `${{ s: 'Thin', m: 'Medium', l: 'Thick' }[k]} (${i + 1})`, 'aria-label': `${{ s: 'Thin', m: 'Medium', l: 'Thick' }[k]} stroke`,
    'aria-pressed': String(editor.size === k), dataset: { size: k },
    onclick: () => { editor.setSize(k); syncToolbar(); },
  }, h('span', { class: 'size-dot', style: { width: `${[4, 7, 11][i]}px`, height: `${[4, 7, 11][i]}px` } }))));
const hint = h('div', { class: 'hint', 'aria-live': 'polite' });
const resetCropBtn = h('button', { class: 'btn sm soft hidden', type: 'button', onclick: () => editor.resetCrop() }, icon('crop'), 'Reset crop');
const downloadTopBtn = h('button', { class: 'btn sm ghost', type: 'button', title: 'Download the annotated screenshot as PNG', onclick: () => downloadPng() }, icon('download'), 'PNG');
$('#stage-bar').append(palette, h('div', { class: 'sep' }), sizeSeg, h('div', { class: 'sep' }), hint, resetCropBtn, downloadTopBtn);
renderPalette();

function setTool(id) {
  if (!state.hasImage) return;
  editor.setTool(id);
  syncToolbar();
  $('#canvas').focus({ preventScroll: true });
}

function syncToolbar() {
  for (const [id, b] of Object.entries(toolButtons)) b.setAttribute('aria-pressed', String(editor.tool === id));
  for (const b of palette.children) b.setAttribute('aria-pressed', String(b.dataset.color === editor.color));
  for (const b of sizeSeg.children) b.setAttribute('aria-pressed', String(b.dataset.size === editor.size));
  undoBtn.disabled = !editor.canUndo;
  redoBtn.disabled = !editor.canRedo;
  clearBtn.disabled = editor.isEmpty;
  resetCropBtn.classList.toggle('hidden', !editor.crop);
  const n = editor.redactionCount;
  hint.textContent = state.hasImage
    ? `${TOOL_HINTS[editor.tool] || ''}${n && editor.tool !== 'redact' ? `  ·  ${n} redaction${n > 1 ? 's' : ''}` : ''}`
    : 'No screenshot attached. Paste (Ctrl+V) or drop an image to add one.';
  rail.classList.toggle('disabled', !state.hasImage);
  $('#stage-bar').classList.toggle('disabled', !state.hasImage);
  downloadTopBtn.disabled = !state.hasImage;
  const dl = document.getElementById('download-png');
  if (dl) dl.disabled = !state.hasImage;
  syncScreenshotOption();
}

// ---------------------------------------------------------------------------
// Image loading (capture, paste, drop)
// ---------------------------------------------------------------------------
const stage = $('#stage');
new ResizeObserver(() => fitEditor()).observe(stage);
function fitEditor() {
  const cs = getComputedStyle(stage);
  editor.fit(stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be loaded'));
    img.src = src;
  });
}

function imageUnit(img) {
  const vw = parseInt(String(captureContext.viewport || '').split('×')[0], 10);
  const raw = vw > 0 && state.imageSource === 'capture' ? img.width / vw : (globalThis.devicePixelRatio || 1);
  return Math.max(1, Math.round(raw * 4) / 4);
}

async function useImage(src, source) {
  const img = await loadImage(src);
  state.hasImage = true;
  state.imageSource = source;
  state.includeScreenshot = ctx.settings.includeScreenshotDefault !== false || source !== 'capture';
  $('#canvas-wrap').classList.remove('hidden');
  $('#stage-empty').classList.add('hidden');
  editor.setImage(img, imageUnit(img));
  fitEditor();
  editor.setTool('arrow');
  syncToolbar();
}

function showStageEmpty() {
  $('#canvas-wrap').classList.add('hidden');
  const reason = capture?.screenshotError
    || (!capture && captureId ? 'This capture is no longer available (captures are kept for a few hours). You can still send a report.' : '')
    || (capture && capture.requested === false ? 'You chose to report without a screenshot.' : 'No screenshot attached.');
  const choose = h('button', { class: 'btn', type: 'button', onclick: async () => {
    const f = await pickFile('image/*');
    if (f) takeImageFile(f);
  } }, icon('image'), 'Choose an image…');
  $('#stage-empty').replaceChildren(h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(capture?.screenshotError ? 'alert' : 'image')),
    h('h3', {}, capture?.screenshotError ? 'This page can’t be captured' : 'No screenshot'),
    h('p', {}, reason),
    h('p', { class: 'subtle' }, 'Paste a screenshot with ', h('kbd', {}, 'Ctrl'), '+', h('kbd', {}, 'V'), ' or drop an image file here to attach one.'),
    choose));
  $('#stage-empty').classList.remove('hidden');
}

async function takeImageFile(file) {
  if (!file || !/^image\//.test(file.type)) return toast('That isn’t an image file', { tone: 'warning' });
  if (file.size > 15 * 1024 * 1024) return toast('That image is larger than 15 MB', { tone: 'warning' });
  try {
    await useImage(await readFile(file, 'dataUrl'), 'pasted');
    toast('Image attached', { tone: 'success' });
  } catch (err) {
    toast(err.message, { tone: 'danger' });
  }
}

document.addEventListener('paste', (e) => {
  if (state.submitted) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  if (state.hasImage && state.imageSource === 'capture') return; // keep the real capture
  e.preventDefault();
  takeImageFile(item.getAsFile());
});
stage.addEventListener('dragover', (e) => { if (!state.hasImage || state.imageSource !== 'capture') { e.preventDefault(); stage.classList.add('dragover'); } });
stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
stage.addEventListener('drop', (e) => {
  stage.classList.remove('dragover');
  if (state.hasImage && state.imageSource === 'capture') return;
  e.preventDefault();
  takeImageFile(e.dataTransfer.files[0]);
});

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------
const panel = $('#panel-body');
const required = () => new Set(ctx.settings.requiredFields || []);
const fields = {};
let screenshotRow, urlRow, diagBox, emailNote, submitBtn, errorBox;

function fieldBlock(label, control, { key, isRequired, help, counter } = {}) {
  const err = h('div', { class: 'error', id: `${key}-error`, role: 'alert' });
  control.setAttribute('aria-describedby', `${key}-error`);
  return h('div', { class: 'field' },
    h('label', { for: control.id }, label, isRequired ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null, counter || null),
    control, help ? h('div', { class: 'help' }, help) : null, err);
}

function renderForm() {
  const s = ctx.settings;
  const req = required();
  const provider = getProvider(s.provider);

  fields.summary = h('input', { class: 'input', id: 'summary', maxlength: 200, autocomplete: 'off', placeholder: 'e.g. Payroll page shows an error when I click Save', required: true });
  const counter = h('span', { class: 'count' }, '0/200');
  fields.summary.addEventListener('input', () => { counter.textContent = `${fields.summary.value.length}/200`; clearError('summary'); state.dirty = true; });

  fields.description = h('textarea', { class: 'textarea', id: 'description', rows: 7, placeholder: s.descriptionTemplate || '' });
  if (s.descriptionPrefill && s.descriptionTemplate) fields.description.value = s.descriptionTemplate;
  fields.description.addEventListener('input', () => { clearError('description'); state.dirty = true; });

  const cats = Array.isArray(s.categories) ? s.categories : DEFAULTS.categories;
  fields.category = h('select', { class: 'select', id: 'category' },
    req.has('category') ? h('option', { value: '' }, 'Choose a category…') : null,
    cats.map((c) => h('option', { value: c }, c)));
  fields.category.value = req.has('category') ? '' : (cats.includes(s.defaultCategory) ? s.defaultCategory : cats[0]);
  fields.category.addEventListener('change', () => clearError('category'));

  const prio = h('div', { class: 'segmented full', role: 'radiogroup', 'aria-label': 'Priority', id: 'priority' },
    PRIORITIES.map((p) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(state.priority === p), 'aria-pressed': String(state.priority === p), dataset: { p },
      onclick: () => { state.priority = p; for (const b of prio.children) { const on = b.dataset.p === p; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); } },
    }, h('span', { class: 'prio-dot', style: { background: PRIORITY_COLORS[p] } }), PRIORITY_LABELS[p])));

  fields.reporterName = h('input', { class: 'input', id: 'reporterName', autocomplete: 'name', value: s.reporterName || '', placeholder: 'Jane Doe' });
  fields.reporterEmail = h('input', { class: 'input', id: 'reporterEmail', type: 'email', autocomplete: 'email', value: s.reporterEmail || '', placeholder: 'jane@company.com' });
  fields.reporterName.addEventListener('input', () => clearError('reporterName'));
  fields.reporterEmail.addEventListener('input', () => clearError('reporterEmail'));
  const emailRequired = req.has('reporterEmail') || provider.needsReporterEmail;

  screenshotRow = h('label', { class: 'check-row' });
  urlRow = h('label', { class: 'check-row' });
  diagBox = h('details', { class: 'diag' });
  emailNote = h('div');
  errorBox = h('div', { class: 'error-box hidden', role: 'alert' });
  submitBtn = h('button', { class: 'btn primary lg block', type: 'submit', id: 'submit' });

  const form = h('form', { id: 'ticket-form', novalidate: true, class: 'stack', onsubmit: onSubmit },
    h('div', { class: 'panel-head' }, h('h2', {}, 'Describe the problem'), h('p', { class: 'subtle' }, 'IT receives this with your annotated screenshot and the diagnostics below.')),
    fieldBlock('Summary', fields.summary, { key: 'summary', isRequired: true, counter }),
    fieldBlock('Description', fields.description, { key: 'description', isRequired: req.has('description'), help: null }),
    cats.length ? fieldBlock('Category', fields.category, { key: 'category', isRequired: req.has('category') }) : null,
    h('div', { class: 'field' }, h('span', { class: 'label', id: 'priority-label' }, 'Priority'), prio),
    h('div', { class: 'grid-2' },
      fieldBlock('Your name', fields.reporterName, { key: 'reporterName', isRequired: req.has('reporterName') }),
      fieldBlock('Your email', fields.reporterEmail, { key: 'reporterEmail', isRequired: emailRequired })),
    h('div', { class: 'options-box' }, screenshotRow, urlRow),
    diagBox,
    emailNote,
    h('div', { class: 'submit-area stack-sm' },
      errorBox,
      submitBtn,
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn ghost sm', type: 'button', id: 'download-png', onclick: () => downloadPng() }, icon('download'), 'Download PNG'),
        h('button', { class: 'btn ghost sm', type: 'button', id: 'copy-details', onclick: () => copyDetails() }, icon('copy'), 'Copy details'))),
  );
  panel.replaceChildren(form);
  prio.querySelectorAll('button').forEach((b) => b.setAttribute('aria-labelledby', 'priority-label'));
  setSubmitLabel();
  syncScreenshotOption();
  renderUrlOption();
  renderDiagnostics();
  renderEmailNote();
  updateProviderChip();
  setTimeout(() => fields.summary.focus(), 50);
}

function setSubmitLabel(progress) {
  const provider = getProvider(ctx.settings.provider);
  submitBtn.disabled = !!progress;
  submitBtn.replaceChildren(...(progress
    ? [h('span', { class: 'spinner' }), progress]
    : [icon(provider.id === 'email' ? 'mail' : 'send'), provider.id === 'email' ? 'Create email' : 'Submit ticket']));
}

function syncScreenshotOption() {
  if (!screenshotRow) return;
  const box = h('input', { type: 'checkbox', id: 'include-screenshot', checked: state.hasImage && state.includeScreenshot, disabled: !state.hasImage,
    onchange: (e) => { state.includeScreenshot = e.target.checked; } });
  const r = state.hasImage ? editor.region : null;
  const n = editor.objects.length;
  screenshotRow.classList.toggle('disabled', !state.hasImage);
  screenshotRow.replaceChildren(box, h('span', {},
    h('span', { class: 't' }, 'Include screenshot'),
    h('span', { class: 's' }, state.hasImage
      ? `${Math.round(r.w)}×${Math.round(r.h)} PNG${n ? ` · ${n} annotation${n > 1 ? 's' : ''}` : ''}${editor.redactionCount ? ` · ${editor.redactionCount} redacted` : ''}`
      : 'No screenshot to attach')));
}

function renderUrlOption() {
  const s = ctx.settings;
  const urlEnabled = s.diagnostics?.url !== false && !!fullDiagnostics.url;
  urlRow.classList.toggle('hidden', !urlEnabled);
  if (!urlEnabled) return;
  const canRemove = s.allowRemoveUrl !== false;
  if (!canRemove) state.includeUrl = true;
  const box = h('input', { type: 'checkbox', id: 'include-url', checked: state.includeUrl, disabled: !canRemove,
    onchange: (e) => { state.includeUrl = e.target.checked; renderDiagnostics(); } });
  urlRow.classList.toggle('disabled', !canRemove);
  urlRow.replaceChildren(box, h('span', { style: { minWidth: 0 } },
    h('span', { class: 't' }, 'Include page address'),
    h('span', { class: 's truncate' }, canRemove ? hostOf(fullDiagnostics.url) || fullDiagnostics.url : 'Required by your organization')));
}

function currentDiagnostics() {
  return filterDiagnostics(fullDiagnostics, ctx.settings.diagnostics || {}, { includeUrl: state.includeUrl });
}

function renderDiagnostics() {
  const entries = diagnosticEntries(currentDiagnostics());
  const disabledByAdmin = DIAGNOSTIC_ITEMS.filter((d) => ctx.settings.diagnostics?.[d.key] === false && d.key !== 'userAgent').length;
  const wasOpen = diagBox.open;
  diagBox.replaceChildren(
    h('summary', {}, icon('activity', { size: 16, class: 'text-primary' }), `Diagnostics attached`, h('span', { class: 'badge' }, String(entries.length)), icon('chevron-down', { size: 16, class: 'chev' })),
    h('div', { class: 'diag-body' },
      h('p', { class: 'subtle', style: { margin: '0 0 8px' } }, 'Exactly what is sent with your ticket:'),
      entries.length
        ? h('dl', { class: 'kv' }, entries.map((e) => [h('dt', {}, e.label), h('dd', {}, e.value)]))
        : h('p', { class: 'muted' }, 'No diagnostics will be attached.'),
      disabledByAdmin ? h('p', { class: 'subtle mt-8' }, icon('lock', { size: 12 }), ` ${disabledByAdmin} item${disabledByAdmin > 1 ? 's are' : ' is'} never collected, by your organization’s settings.`) : null));
  diagBox.open = wasOpen;
}

function renderEmailNote() {
  const p = getProvider(ctx.settings.provider);
  emailNote.replaceChildren();
  if (p.id === 'email') {
    emailNote.append(h('div', { class: 'callout' }, icon('mail'),
      h('div', {}, h('strong', {}, 'Sent by email. '), `Your email app opens with everything filled in, addressed to ${providerTarget(ctx.settings) || 'the help desk'}. The annotated screenshot is saved to your Downloads folder — attach it before sending.`)));
  }
  const problems = providerProblems(ctx.settings);
  if (problems.length) {
    emailNote.append(h('div', { class: 'callout warning mt-8' }, icon('alert'),
      h('div', {}, h('strong', {}, 'Ticket Snap isn’t fully set up. '), `Missing: ${problems.join(', ')}. You can still download the screenshot and copy the details. `,
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); openOptions(); } }, 'Open settings'))));
  }
}

function updateProviderChip() {
  const p = getProvider(ctx.settings.provider);
  const target = providerTarget(ctx.settings);
  providerChip.replaceChildren(icon(p.icon), `${p.short || p.label}${target ? ` · ${target}` : ''}`);
  providerChip.title = `Tickets are sent to ${p.label}${target ? ` (${target})` : ''}`;
}

// ---------------------------------------------------------------------------
// Validation & ticket assembly
// ---------------------------------------------------------------------------
function setError(key, msg) {
  const el = fields[key];
  el?.classList.add('invalid');
  el?.setAttribute('aria-invalid', 'true');
  const err = document.getElementById(`${key}-error`);
  if (err) err.textContent = msg;
}
function clearError(key) {
  fields[key]?.classList.remove('invalid');
  fields[key]?.removeAttribute('aria-invalid');
  const err = document.getElementById(`${key}-error`);
  if (err) err.textContent = '';
}

function validate() {
  const req = required();
  const provider = getProvider(ctx.settings.provider);
  const problems = [];
  for (const k of ['summary', 'description', 'category', 'reporterName', 'reporterEmail']) clearError(k);
  if (!fields.summary.value.trim()) problems.push(['summary', 'Add a short summary of the problem.']);
  if (req.has('description') && !fields.description.value.trim()) problems.push(['description', 'Please describe what happened.']);
  if (req.has('category') && fields.category.options.length && !fields.category.value) problems.push(['category', 'Choose a category.']);
  if (req.has('reporterName') && !fields.reporterName.value.trim()) problems.push(['reporterName', 'Enter your name.']);
  const email = fields.reporterEmail.value.trim();
  if ((req.has('reporterEmail') || provider.needsReporterEmail) && !email) problems.push(['reporterEmail', 'Enter your email so IT can reply.']);
  else if (email && !EMAIL_RE.test(email)) problems.push(['reporterEmail', 'That doesn’t look like an email address.']);
  for (const [k, m] of problems) setError(k, m);
  if (problems.length) fields[problems[0][0]].focus();
  return problems.length === 0;
}

function readTicket() {
  const prefix = String(ctx.settings.summaryPrefix || '').trim();
  const summary = fields.summary.value.trim();
  let description = fields.description.value.trim();
  if (description === String(ctx.settings.descriptionTemplate || '').trim()) description = '';
  return {
    summary: prefix && !summary.startsWith(prefix) ? `${prefix} ${summary}` : summary,
    description,
    category: fields.category.value,
    priority: state.priority,
    reporter: { name: fields.reporterName.value.trim(), email: fields.reporterEmail.value.trim() },
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
let lastBlob = null;
async function exportPng() {
  if (!state.hasImage) return null;
  lastBlob = await editor.exportBlob();
  return lastBlob;
}

async function downloadPng() {
  if (!state.hasImage) return toast('There is no screenshot to download', { tone: 'warning' });
  const blob = await exportPng();
  downloadFile(screenshotName(captureContext), blob);
  toast('Screenshot downloaded', { tone: 'success' });
}

async function copyDetails() {
  const ok = await copyText(detailsText(readTicket(), currentDiagnostics()));
  toast(ok ? 'Ticket details copied' : 'Copy failed', { tone: ok ? 'success' : 'danger' });
}

async function closeTab() {
  try { const t = await api.tabs.getCurrent(); if (t?.id != null) return api.tabs.remove(t.id); } catch { /* fall through */ }
  window.close();
}

function openMailto(href) {
  const a = h('a', { href, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  a.remove();
}

function showError(err, provider) {
  const isConfig = err?.kind === 'config';
  errorBox.classList.remove('hidden');
  errorBox.replaceChildren(h('div', { class: 'callout danger' }, icon('alert'), h('div', { style: { minWidth: 0 } },
    h('strong', {}, 'The ticket couldn’t be submitted'),
    h('div', { class: 'mt-4' }, err?.message || String(err)),
    h('div', { class: 'actions' },
      h('button', { class: 'btn sm primary', type: 'submit' }, icon('refresh'), 'Try again'),
      h('button', { class: 'btn sm', type: 'button', onclick: async () => { if (state.hasImage) await downloadPng(); await copyDetails(); } }, icon('download'), state.hasImage ? 'Download screenshot + copy details' : 'Copy details'),
      isConfig ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => openOptions() }, icon('settings'), 'Settings') : null),
    !isConfig && provider?.id !== 'email' && ctx.brand.supportEmail ? h('div', { class: 'subtle mt-8' }, 'You can also email the details to ', h('a', { href: `mailto:${ctx.brand.supportEmail}` }, ctx.brand.supportEmail), '.') : null)));
  errorBox.scrollIntoView({ block: 'nearest' });
}

function onSubmit(e) {
  e.preventDefault();
  if (state.busy) return;
  if (!validate()) return;
  const settings = ctx.settings;
  const provider = getProvider(settings.provider);
  // Host permission must be requested synchronously inside the click, before any other await.
  const endpoint = provider.endpoint(settings);
  const permission = endpoint ? ensureHostPermission(endpoint) : Promise.resolve(true);
  submit(provider, settings, permission, endpoint);
}

async function submit(provider, settings, permission, endpoint) {
  state.busy = true;
  errorBox.classList.add('hidden');
  setSubmitLabel(endpoint ? 'Checking permission…' : 'Preparing…');
  let granted = true;
  try { granted = await permission; } catch { granted = false; }
  try {
    const ticket = readTicket();
    const context = currentDiagnostics();
    setSubmitLabel('Rendering screenshot…');
    const blob = state.hasImage && state.includeScreenshot ? await exportPng() : null;
    const attachmentName = screenshotName(captureContext);
    const result = await provider.submit({ ticket, context, screenshotBlob: blob, settings, attachmentName, onProgress: (m) => setSubmitLabel(m) });
    if (result.mailto) {
      if (result.downloadScreenshot && blob) downloadFile(attachmentName, blob);
      openMailto(result.mailto);
    }
    if (settings.keepHistory !== false) {
      await addHistory({ summary: ticket.summary, time: new Date().toISOString(), provider: provider.id, providerLabel: provider.label, id: result.id || null, url: result.url || null, category: ticket.category, priority: ticket.priority, page: context.url ? hostOf(context.url) : '' });
    }
    state.submitted = true;
    if (captureId) removeCapture(captureId);
    showSuccess({ result, provider, ticket, blob, attachmentName });
  } catch (err) {
    if (!granted && (err?.kind === 'network' || err instanceof TypeError)) {
      err = { message: `Ticket Snap needs your permission to contact ${hostOf(endpoint)}. Click “Try again” and choose “Allow” when the browser asks.` };
    }
    showError(err, provider);
  } finally {
    state.busy = false;
    if (!state.submitted) setSubmitLabel();
  }
}

function showSuccess({ result, provider, ticket, blob, attachmentName }) {
  const isEmail = !!result.mailto;
  const copyLink = result.url ? h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Copy link', 'aria-label': 'Copy ticket link', onclick: async () => { await copyText(result.url); toast('Link copied', { tone: 'success' }); } }, icon('copy')) : null;
  const thumb = blob ? h('img', { alt: 'Screenshot that was attached', src: URL.createObjectURL(blob) }) : null;
  panel.replaceChildren(h('div', { class: 'success', role: 'status' },
    h('div', { class: 'big-icon' }, icon(isEmail ? 'mail' : 'check')),
    h('h2', {}, isEmail ? 'Your email is ready' : 'Ticket submitted'),
    h('p', { class: 'muted mt-4' }, isEmail
      ? `Your email app should have opened. ${blob ? `Attach ${attachmentName} from your Downloads folder, then press Send.` : 'Check the message and press Send.'}`
      : `Sent to ${provider.label}. IT will be in touch${ticket.reporter.email ? ` at ${ticket.reporter.email}` : ''}.`),
    result.id ? h('div', { class: 'ticket-id' }, icon('ticket', { size: 18 }), result.id, copyLink) : null,
    h('div', { class: 'row mt-16', style: { justifyContent: 'center', flexWrap: 'wrap' } },
      result.url ? h('a', { class: 'btn primary', href: result.url, target: '_blank', rel: 'noopener' }, icon('external'), 'Open ticket') : null,
      isEmail ? h('button', { class: 'btn primary', type: 'button', onclick: () => openMailto(result.mailto) }, icon('mail'), 'Open email again') : null,
      isEmail && blob ? h('button', { class: 'btn', type: 'button', onclick: () => downloadFile(attachmentName, blob) }, icon('download'), 'Download screenshot again') : null),
    (result.warnings || []).map((w) => h('div', { class: 'callout warning mt-16', style: { textAlign: 'left' } }, icon('alert'), h('div', {}, w))),
    h('div', { class: 'card tight recap' },
      h('div', { class: 'subtle' }, `${ticket.category || 'No category'} · ${PRIORITY_LABELS[ticket.priority]} priority`),
      h('strong', {}, ticket.summary),
      thumb),
    h('div', { class: 'row mt-16', style: { justifyContent: 'center' } },
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => closeTab() }, icon('x'), 'Close this tab'),
      blob && !isEmail ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => downloadFile(attachmentName, blob) }, icon('download'), 'Download PNG') : null)));
  rail.classList.add('disabled');
  $('#stage-bar').classList.add('disabled');
  hint.textContent = 'Submitted. This screenshot can no longer be edited.';
  editor.setTool('select');
  editor.canvas.style.pointerEvents = 'none';
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------
const TOOL_KEYS = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));
document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); $('#ticket-form')?.requestSubmit(); return; }
  if (typing || state.submitted || !state.hasImage) return;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) editor.redo(); else editor.undo(); syncToolbar(); return; }
  if (mod && k === 'y') { e.preventDefault(); editor.redo(); syncToolbar(); return; }
  if (mod || e.altKey) return;
  if (TOOL_KEYS[k]) { e.preventDefault(); setTool(TOOL_KEYS[k]); return; }
  if (['1', '2', '3'].includes(k)) { editor.setSize(['s', 'm', 'l'][Number(k) - 1]); syncToolbar(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && editor.deleteSelected()) { e.preventDefault(); return; }
  if (e.key === 'Escape' && editor.selected >= 0) { editor.selected = -1; editor.render(); }
});

window.addEventListener('beforeunload', (e) => {
  if (!state.submitted && (state.dirty || fields.summary?.value.trim())) { e.preventDefault(); e.returnValue = ''; }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
renderForm();
ctx.onChange(() => {
  if (state.submitted) return;
  renderPalette();
  updateProviderChip();
  renderUrlOption();
  renderDiagnostics();
  renderEmailNote();
  setSubmitLabel();
  syncToolbar();
});

$('#stage-loading').remove();
if (capture?.image) {
  try { await useImage(capture.image, 'capture'); } catch { showStageEmpty(); }
} else {
  showStageEmpty();
}
syncToolbar();
document.title = `${captureContext.title ? `Report: ${captureContext.title}` : 'Report a problem'} · ${ctx.brand.companyName}`;
