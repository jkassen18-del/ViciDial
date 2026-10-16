// UI helpers shared by the popup, dashboard and options pages.
import { h, icon, faviconFor, dialog, formatDuration } from './shared/ui.js';
import { monogram } from './shared/brand.js';

export const STATUS = {
  sanctioned: { label: 'Approved', tone: 'success', icon: 'shield-check' },
  unsanctioned: { label: 'Not approved', tone: 'danger', icon: 'shield-alert' },
  unknown: { label: 'Unclassified', tone: '', icon: 'help' },
};

export function statusBadge(status, { compact = false } = {}) {
  const s = STATUS[status] || STATUS.unknown;
  return h('span', { class: `badge ${s.tone}`, title: compact ? s.label : null }, icon(s.icon), compact ? null : s.label);
}

/** Favicon tile with a monogram fallback when the icon cannot load. */
export function appIcon(domain, name, { size = 34 } = {}) {
  const tile = h('span', { class: 'app-icon', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' });
  const fallback = () => { tile.classList.add('mono'); tile.replaceChildren(monogram(name || domain)); };
  const src = faviconFor(domain, 32);
  if (!src) { fallback(); return tile; }
  const img = h('img', { src, alt: '', width: Math.round(size * 0.56), height: Math.round(size * 0.56), loading: 'lazy' });
  img.addEventListener('error', fallback);
  // Chrome's favicon cache returns a generic globe for unknown sites; that's fine.
  tile.append(img);
  return tile;
}

/** Seconds -> "1h 05m" / "12m" / "<1m". */
export function fmtSeconds(sec) {
  if (!sec) return '0m';
  if (sec < 60) return '<1m';
  return formatDuration(sec / 60);
}

export function fmtDay(day) {
  if (!day) return 'Never';
  const d = new Date(`${day}T12:00:00`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "today", "yesterday", "5 days ago" for a YYYY-MM-DD key. */
export function daysAgo(day) {
  if (!day) return 'never';
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const d = new Date(`${day}T12:00:00`);
  const n = Math.round((today - d) / 86400000);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

/** The "What is collected?" explanation, shown from the popup, dashboard and options. */
export function privacyDialog(ctx) {
  const company = ctx.brand.companyName;
  const s = ctx.settings;
  const yes = (t) => h('li', {}, icon('check', { class: 'text-success' }), h('span', {}, t));
  const no = (t) => h('li', {}, icon('x', { class: 'text-danger' }), h('span', {}, t));
  const sending = s.reportingEnabled && s.reportEndpoint;
  return dialog({
    title: 'What is collected?',
    icon: 'shield',
    wide: true,
    body: h('div', { class: 'stack privacy-dialog' },
      h('p', { class: 'muted' }, `${company} uses this extension to see which online tools are in use, so IT can support approved apps, spot risky ones and stop paying for licences nobody uses.`),
      h('div', { class: 'grid-2' },
        h('div', { class: 'card tight flat' }, h('h4', {}, 'Recorded'), h('ul', { class: 'check-list' },
          yes('The app\'s domain, e.g. slack.com'),
          yes('How many times you opened it each day'),
          yes('Minutes it was in your focused tab while you were active'),
          yes('The last day you used it'))),
        h('div', { class: 'card tight flat' }, h('h4', {}, 'Never recorded'), h('ul', { class: 'check-list' },
          no('Full web addresses, paths or search terms'),
          no('Page titles, content, keystrokes or screenshots'),
          no('Private / incognito windows'),
          no(s.trackingScope === 'all-domains' ? 'Company-internal sites' : 'Sites that are not known SaaS apps')))),
      h('div', { class: `callout ${sending ? '' : 'success'}` }, icon(sending ? 'send' : 'lock'), h('div', {},
        sending
          ? [h('strong', {}, 'What is sent to IT. '), `Once every ${s.reportIntervalHours} hours, totals per app for the last ${s.reportPeriodDays} days, tagged with a random install ID${s.department ? ` and the department "${s.department}"` : ''}${s.includeUserEmail && s.userEmail ? ` and your email (${s.userEmail})` : ''}. ${s.includeUserEmail && s.userEmail ? '' : 'Your name and email are not included.'}`]
          : [h('strong', {}, 'Nothing is sent right now. '), 'Reporting is not configured, so usage stays on this device.'])),
      h('p', { class: 'subtle' }, `Local data is kept for ${s.retentionDays} days. You can see everything that is stored on the dashboard.`)),
    actions: [{ label: 'Got it', value: true, variant: 'primary' }],
  });
}
