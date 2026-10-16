import { initPage } from './shared/page.js';
import { api, openExtensionPage, openOptions } from './shared/browser.js';
import { send } from './shared/messaging.js';
import { h, icon, $, render, formatNumber } from './shared/ui.js';
import { DEFAULTS, PRODUCT } from './defaults.js';
import { createMatcher, aggregate, lastDays } from './logic.js';
import { statusBadge, appIcon, fmtSeconds, privacyDialog, daysAgo } from './common.js';

const iconBtn = (name, label, onclick) => h('button', { class: 'btn ghost icon sm', type: 'button', title: label, 'aria-label': label, onclick }, icon(name));

const ctx = await initPage({
  defaults: DEFAULTS,
  title: PRODUCT,
  headerActions: [
    iconBtn('chart', 'Open dashboard', () => { openExtensionPage('dashboard.html'); window.close(); }),
    iconBtn('settings', 'Settings', () => { openOptions(); window.close(); }),
  ],
});

async function currentTabId() {
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch { return null; }
}

function currentCard(st) {
  if (!st || st.kind === 'none' || st.kind === 'private') {
    return h('div', { class: 'card tight current none' },
      h('div', { class: 'row gap-12' },
        h('span', { class: 'app-icon mono' }, icon('globe')),
        h('div', { class: 'grow' },
          h('div', { class: 'strong' }, st?.kind === 'private' ? 'Private window' : 'No web app in this tab'),
          h('div', { class: 'subtle' }, st?.kind === 'private' ? 'Nothing is recorded in private browsing.' : 'Open a website to see whether it is an approved app.'))));
  }
  if (st.kind === 'untracked') {
    return h('div', { class: 'card tight current' },
      h('div', { class: 'row gap-12' },
        appIcon(st.host, st.host),
        h('div', { class: 'grow' },
          h('div', { class: 'strong truncate' }, st.host),
          h('div', { class: 'subtle' }, st.ignored ? 'Company site, not recorded' : 'Not a tracked SaaS app, not recorded')),
        h('span', { class: 'badge' }, icon('eye-off'), 'Not recorded')));
  }
  const app = st.app;
  const tone = app.status === 'unsanctioned' ? 'danger' : app.status === 'sanctioned' ? 'success' : '';
  return h('div', { class: `card tight current ${tone}` },
    h('div', { class: 'row gap-12' },
      appIcon(app.domain, app.name),
      h('div', { class: 'grow' },
        h('div', { class: 'strong truncate' }, app.name),
        h('div', { class: 'subtle truncate' }, `${app.category} · ${app.domain}`)),
      statusBadge(app.status)),
    app.status === 'unsanctioned'
      ? h('div', { class: 'callout danger mt-8' }, icon('shield-alert'), h('div', {},
        `${ctx.brand.companyName} hasn't approved this app.`,
        st.alternative?.name ? [' Try ', st.alternative.url ? h('a', { href: st.alternative.url, target: '_blank', rel: 'noopener' }, st.alternative.name) : h('strong', {}, st.alternative.name), ' instead.'] : ' Please use an approved tool for work data.'))
      : null,
    !st.tracking ? h('div', { class: 'subtle mt-8' }, 'Tracking is paused.') : null);
}

async function load() {
  const [usage, st] = await Promise.all([
    send('getUsage', { days: 7 }).catch(() => ({ days: {}, lastSeen: {} })),
    currentTabId().then((tabId) => send('tabStatus', { tabId })).catch(() => null),
  ]);
  const matcher = createMatcher(ctx.settings);
  const week = new Set(lastDays(7));
  const days = Object.fromEntries(Object.entries(usage.days).filter(([d]) => week.has(d)));
  const apps = aggregate(days).map((a) => ({ ...a, info: matcher.describe(a.domain) }));
  const totalSec = apps.reduce((s, a) => s + a.activeSeconds, 0);
  const totalVisits = apps.reduce((s, a) => s + a.visits, 0);
  const notApproved = apps.filter((a) => a.info.status === 'unsanctioned').length;
  const top = apps.slice(0, 6);
  const max = Math.max(1, ...top.map((a) => a.activeSeconds));

  const main = $('#main');
  main.removeAttribute('aria-busy');
  render(main,
    !ctx.settings.trackingEnabled ? h('div', { class: 'callout warning' }, icon('power'), h('div', {}, h('strong', {}, 'Tracking is turned off. '), 'No new usage is being recorded.')) : null,
    h('section', { 'aria-label': 'Current tab' }, currentCard(st)),
    h('section', { class: 'mt-12', 'aria-label': 'This week' },
      h('div', { class: 'row between section-title' }, h('h4', {}, 'This week'), usage.demo ? h('span', { class: 'badge warning' }, 'Demo data') : null),
      h('div', { class: 'mini-stats' },
        mini('Apps used', formatNumber(apps.length)),
        mini('Active time', fmtSeconds(totalSec)),
        mini('Not approved', formatNumber(notApproved), notApproved ? 'danger' : ''))),
    h('section', { class: 'mt-12', 'aria-label': 'Top apps' },
      h('h4', { class: 'section-title' }, 'Top apps'),
      top.length
        ? h('div', { class: 'list app-list' }, top.map((a) => h('div', { class: 'list-item static' },
          appIcon(a.domain, a.info.name),
          h('div', { class: 'li-main' },
            h('div', { class: 'row between gap-4' },
              h('span', { class: 'li-title truncate' }, a.info.name),
              h('span', { class: 'li-meta mono' }, fmtSeconds(a.activeSeconds))),
            h('div', { class: 'row between gap-4' },
              h('span', { class: 'li-sub truncate' }, `${a.info.category} · ${a.visits} visit${a.visits === 1 ? '' : 's'} · ${daysAgo(a.lastSeen)}`),
              statusBadge(a.info.status, { compact: true })),
            h('div', { class: 'bar thin mt-4', role: 'presentation' }, h('span', { style: { width: `${Math.max(3, (a.activeSeconds / max) * 100)}%` } }))))))
        : h('div', { class: 'empty compact' },
          h('div', { class: 'empty-icon' }, icon('activity')),
          h('h3', {}, 'Nothing recorded yet'),
          h('p', { class: 'subtle' }, 'Apps you use in the browser will show up here, with the time you spent in them.'))),
    h('div', { class: 'row gap-8 mt-16' },
      h('button', { class: 'btn primary grow', type: 'button', onclick: () => { openExtensionPage('dashboard.html'); window.close(); } }, icon('chart'), 'Open dashboard'),
      h('button', { class: 'btn', type: 'button', onclick: () => privacyDialog(ctx) }, icon('shield'), 'What is collected?')),
    h('p', { class: 'subtle center mt-8' }, `${formatNumber(totalVisits)} visits this week · domains only, never page addresses`),
  );
}

function mini(label, value, tone = '') {
  return h('div', { class: `mini-stat ${tone}` }, h('div', { class: 'v' }, value), h('div', { class: 'l' }, label));
}

ctx.onChange(load);
load();
