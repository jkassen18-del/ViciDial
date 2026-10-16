// Small UI helpers shared by the popup and the options page.
import { h, icon } from './shared/ui.js';
import { ACTION_LABELS, CHANNEL_LABELS } from './defaults.js';

export const DECISION = {
  cancelled: { label: 'Cancelled', tone: 'success', icon: 'x' },
  proceeded: { label: 'Continued', tone: 'warning', icon: 'arrow-right' },
  blocked: { label: 'Blocked', tone: 'danger', icon: 'lock' },
  logged: { label: 'Logged', tone: '', icon: 'list' },
};
export const ACTION_TONE = { off: '', log: '', warn: 'warning', block: 'danger' };
export const CHANNEL_ICON = { paste: 'copy', drop: 'download', upload: 'upload', submit: 'send' };

export const actionBadge = (a) => h('span', { class: `badge ${ACTION_TONE[a] || ''}` }, ACTION_LABELS[a] || a);
export function decisionBadge(d) {
  const m = DECISION[d] || { label: d, tone: '' };
  return h('span', { class: `badge ${m.tone}` }, m.icon && icon(m.icon), m.label);
}
export const channelLabel = (c) => CHANNEL_LABELS[c] || c;

export function incidentRules(i) {
  return (i.detections || []).map((d) => `${d.ruleName || d.ruleId}${d.count > 1 ? ` ×${d.count}` : ''}`).join(', ') || 'Policy';
}

/** Detection results as a list (masked samples only). */
export function detectionList(dets, actions = {}) {
  return h('div', { class: 'det-list' }, dets.map((d) => {
    const a = actions[d.ruleId] || 'warn';
    return h('div', { class: `det det-${a}` },
      h('div', { class: 'det-head' },
        h('span', { class: 'det-name' }, d.ruleName),
        d.count > 1 ? h('span', { class: 'badge' }, `×${d.count}`) : null,
        h('span', { class: 'grow' }),
        actionBadge(a)),
      d.samples?.length ? h('div', { class: 'det-samples' }, d.samples.map((s) => h('code', {}, s))) : null);
  }));
}

/** Renders `text` with <mark> elements over the detection spans (DOM only, no innerHTML). */
export function highlighted(text, dets, actions = {}) {
  const spans = [];
  for (const d of dets) for (const s of d.spans || []) spans.push({ ...s, a: actions[d.ruleId] || 'warn', name: d.ruleName });
  spans.sort((x, y) => x.start - y.start || y.end - x.end);
  const out = h('div', { class: 'hl' });
  let pos = 0;
  for (const s of spans) {
    if (s.start < pos) continue; // overlapping span: first one wins
    if (s.start > pos) out.append(text.slice(pos, s.start));
    out.append(h('mark', { class: `m-${s.a}`, title: s.name }, text.slice(s.start, s.end)));
    pos = s.end;
  }
  if (pos < text.length) out.append(text.slice(pos));
  return out;
}
