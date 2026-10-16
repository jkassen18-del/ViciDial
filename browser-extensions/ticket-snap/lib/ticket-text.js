// Formats a ticket + diagnostics as plain text, HTML or a mailto body.
import { DIAGNOSTIC_ITEMS, displayValue } from './diagnostics.js';
import { PRIORITY_LABELS } from '../defaults.js';

export { PRIORITY_LABELS };

export function diagnosticEntries(context = {}) {
  return DIAGNOSTIC_ITEMS.filter((d) => context[d.key] !== undefined && context[d.key] !== '')
    .map((d) => ({ key: d.key, label: d.label, value: displayValue(d.key, context[d.key]) }));
}

function reporterLine(r = {}) {
  if (r.name && r.email) return `${r.name} <${r.email}>`;
  return r.name || r.email || '';
}

/** Plain-text body: description followed by ticket meta and diagnostics. */
export function plainBody(ticket, context, { includeMeta = true } = {}) {
  const lines = [];
  lines.push((ticket.description || '').trim() || '(no description provided)');
  lines.push('', '----', '');
  if (includeMeta) {
    if (ticket.category) lines.push(`Category: ${ticket.category}`);
    if (ticket.priority) lines.push(`Priority: ${PRIORITY_LABELS[ticket.priority] || ticket.priority}`);
    const rep = reporterLine(ticket.reporter);
    if (rep) lines.push(`Reported by: ${rep}`);
    lines.push('');
  }
  const diag = diagnosticEntries(context);
  if (diag.length) {
    lines.push('Diagnostics');
    for (const d of diag) lines.push(`${d.label}: ${d.value}`);
  }
  lines.push('', 'Sent with Ticket Snap');
  return lines.join('\n');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** HTML body (Freshdesk and other HTML-capable desks). */
export function htmlBody(ticket, context) {
  const desc = (ticket.description || '').trim() || '(no description provided)';
  const meta = [
    ticket.category && ['Category', ticket.category],
    ticket.priority && ['Priority', PRIORITY_LABELS[ticket.priority] || ticket.priority],
    reporterLine(ticket.reporter) && ['Reported by', reporterLine(ticket.reporter)],
  ].filter(Boolean);
  const diag = diagnosticEntries(context);
  const rows = (list) => list.map(([k, v]) => `<tr><td><strong>${esc(k)}</strong></td><td>${esc(v)}</td></tr>`).join('');
  return [
    `<div>${desc.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>`,
    '<hr>',
    meta.length ? `<table>${rows(meta)}</table>` : '',
    diag.length ? `<p><strong>Diagnostics</strong></p><table>${rows(diag.map((d) => [d.label, d.value]))}</table>` : '',
    '<p><em>Sent with Ticket Snap</em></p>',
  ].join('');
}

/** Text placed on the clipboard by "Copy details". */
export function detailsText(ticket, context) {
  return [`Summary: ${ticket.summary || ''}`, '', plainBody(ticket, context)].join('\n');
}
