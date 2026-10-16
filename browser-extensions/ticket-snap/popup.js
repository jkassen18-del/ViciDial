// Toolbar popup: capture the current tab, report without screenshot, recent tickets.
import { initPage } from './shared/page.js';
import { api, extUrl, openOptions, openExtensionPage } from './shared/browser.js';
import { send } from './shared/messaging.js';
import { isRestrictedUrl } from './shared/domain.js';
import { h, $, icon, toast, relativeTime } from './shared/ui.js';
import { DEFAULTS } from './defaults.js';
import { getProvider, providerProblems, providerTarget } from './providers/index.js';
import { getHistory } from './lib/history.js';

const settingsBtn = h('button', { class: 'btn ghost icon sm', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: () => { openOptions(); window.close(); } }, icon('settings'));
const ctx = await initPage({
  defaults: DEFAULTS,
  title: 'Ticket Snap',
  headerActions: [settingsBtn],
  footerExtra: () => h('a', { href: '#', onclick: (e) => { e.preventDefault(); openOptions(); window.close(); } }, 'Settings'),
});

const [tabs, history, commands] = await Promise.all([
  api.tabs.query({ active: true, currentWindow: true }).catch(() => []),
  getHistory(),
  api.commands?.getAll?.().catch(() => []) ?? [],
]);
const tab = tabs[0];
const ownPage = !!tab?.url && tab.url.startsWith(extUrl(''));
const capturable = !!tab && !ownPage && !(tab.url && isRestrictedUrl(tab.url));
const shortcut = (commands || []).find((c) => c.name === 'capture-tab')?.shortcut || '';

let busy = false;
async function capture(screenshot, btn) {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  btn.prepend(h('span', { class: 'spinner' }));
  try {
    await send('capture', { tabId: tab && !ownPage ? tab.id : undefined, screenshot });
    window.close();
  } catch (err) {
    toast(err.message || String(err), { tone: 'danger', timeout: 5000 });
    btn.querySelector('.spinner')?.remove();
    btn.disabled = false;
    busy = false;
  }
}

function hostLabel(url) {
  try { return new URL(url).host || url; } catch { return url || ''; }
}

function render() {
  const main = $('#main');
  const s = ctx.settings;
  const provider = getProvider(s.provider);
  const problems = providerProblems(s);
  const target = providerTarget(s);

  const fav = h('span', { class: 'fav' });
  if (capturable && tab.favIconUrl && /^(https?|data):/.test(tab.favIconUrl)) {
    const img = h('img', { src: tab.favIconUrl, alt: '' });
    img.addEventListener('error', () => fav.replaceChildren(icon('globe')));
    fav.append(img);
  } else fav.append(icon(capturable ? 'globe' : 'slash'));

  const pageRow = h('div', { class: 'page-row' }, fav, h('div', { style: { minWidth: 0 } },
    h('div', { class: 't truncate' }, capturable ? (tab.title || hostLabel(tab.url) || 'Current tab') : 'Nothing to capture here'),
    h('div', { class: 's truncate' }, capturable ? hostLabel(tab.url) : 'Browser and extension pages can’t be captured')));

  const captureBtn = h('button', { class: 'btn primary block capture-btn', type: 'button', id: 'capture', disabled: !capturable,
    onclick: (e) => capture(true, e.currentTarget) },
  icon('camera'), h('span', { class: 'lbl' }, 'Capture this tab'), shortcut ? h('kbd', {}, shortcut) : null);
  const textBtn = h('button', { class: `btn ${capturable ? 'ghost' : 'primary'} block text-btn`, type: 'button', id: 'report-text',
    onclick: (e) => capture(false, e.currentTarget) },
  icon('file-text'), capturable ? 'Report without a screenshot' : 'Report a problem');

  const setup = problems.length
    ? h('div', { class: 'callout warning mt-12' }, icon('alert'), h('div', {},
      h('strong', {}, 'Finish setting up. '), `${provider.label}: ${problems.join(', ')} missing. `,
      ctx.isLocked('provider') ? 'Contact IT.' : h('a', { href: '#', onclick: (e) => { e.preventDefault(); openOptions(); window.close(); } }, 'Open settings')))
    : null;

  const items = (history || []).slice(0, 5);
  const recent = items.length
    ? h('div', { class: 'list recent' }, items.map((t) => {
      const open = () => { if (t.url) { api.tabs.create({ url: t.url }); window.close(); } };
      return h(t.url ? 'a' : 'div', {
        class: 'list-item', ...(t.url ? { href: t.url, onclick: (e) => { e.preventDefault(); open(); }, title: `Open ${t.id || 'ticket'}` } : { tabindex: 0 }),
      },
      h('span', { class: 'li-icon' }, icon(t.provider === 'email' ? 'mail' : 'ticket')),
      h('span', { class: 'li-main' },
        h('div', { class: 'li-title' }, t.summary || '(no summary)'),
        h('div', { class: 'li-sub' }, [t.id, t.providerLabel || t.provider, relativeTime(t.time)].filter(Boolean).join(' · '))),
      t.url ? h('span', { class: 'li-meta' }, icon('external', { size: 14 })) : null);
    }))
    : h('div', { class: 'empty compact' },
      h('div', { class: 'empty-icon' }, icon('ticket')),
      h('h3', {}, 'No tickets yet'),
      h('div', { class: 'subtle' }, 'Problems you report appear here with a link to the ticket.'));

  main.replaceChildren(...[
    h('section', { class: 'hero' }, pageRow, captureBtn, textBtn,
      h('div', { class: 'target' }, icon(provider.icon), h('span', { class: 'truncate' }, `Sends to ${provider.label}${target ? ` · ${target}` : ''}`))),
    setup,
    h('div', { class: 'section-label' }, h('h4', {}, 'Recent tickets'),
      items.length ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); openExtensionPage('options.html#history'); window.close(); } }, 'View all') : null),
    recent,
  ].filter(Boolean));
  (capturable ? captureBtn : textBtn).focus();
}

render();
ctx.onChange(render);
