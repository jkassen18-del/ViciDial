// Branded "go/xyz isn't a link yet" page, loaded by go.js only when resolution fails.

import { initPage, brandMark } from './shared/page.js';
import { h, icon, $, debounce, toast } from './shared/ui.js';
import { send } from './shared/messaging.js';
import { DEFAULTS } from './defaults.js';
import * as R from './resolver.js';
import { linkCard, personalLinkFields } from './components.js';

export async function showNotFound(res, input) {
  const ctx = await initPage({ defaults: DEFAULTS, title: 'Go-Links' });
  const shortHost = ctx.settings.shortHost || 'go';
  document.getElementById('boot')?.remove();
  for (const id of ['app-header', 'main', 'app-footer']) document.getElementById(id).hidden = false;

  const data = await send('getData').catch(() => ({ links: [], usage: {}, sources: [] }));
  const index = R.buildIndex([{ id: 'all', kind: 'source', links: data.links }]);
  // keep source info (buildIndex re-tags entries)
  const original = new Map(data.links.map((l) => [l.key, l]));
  const full = (l) => original.get(l.key) || l;

  const key = res.key || R.cleanKey(input.split(/[/?#\s]/)[0]);
  const parsed = R.parseInput(input, { shortHost });
  document.title = `${shortHost}/${key} · ${ctx.brand.companyName}`;

  const searchInput = h('input', { class: 'input', type: 'search', placeholder: 'Search all company links…', 'aria-label': 'Search links', value: '' });
  const resultsTitle = h('div', { class: 'section-label' });
  const results = h('div', { class: 'card-grid' });

  function renderResults(q) {
    let list;
    if (q.trim()) {
      list = R.search(index, q, { limit: 12, usage: data.usage, shortHost }).map((r) => full(r.link));
      resultsTitle.replaceChildren(h('span', { class: 'left' }, icon('search'), `Results for “${q.trim()}”`), h('span', {}, String(list.length)));
    } else {
      list = (res.suggestions || []).map((s) => full(s));
      resultsTitle.replaceChildren(h('span', { class: 'left' }, icon('sparkle'), list.length ? 'Did you mean' : 'No close matches'));
    }
    if (!list.length) {
      results.replaceChildren(h('div', { class: 'empty', style: { gridColumn: '1 / -1' } },
        h('div', { class: 'empty-icon' }, icon('search')),
        h('h3', {}, q.trim() ? 'Nothing matches that search' : `Nothing looks like ${shortHost}/${key}`),
        h('p', {}, data.links.length ? 'Try another word, or browse every department in the directory.' : 'No company links are loaded yet. Ask IT which link sources to add, or check Settings.')));
      return;
    }
    results.replaceChildren(...list.map((l) => {
      // carry the extra path/query over to the suggestion: go/payrol/2026 → go/payroll/2026
      const card = linkCard(l, { shortHost, newTab: false });
      if (parsed.args.length || parsed.query || parsed.hash) {
        card.href = R.expand(l, parsed);
      }
      return card;
    }));
  }
  searchInput.addEventListener('input', debounce(() => renderResults(searchInput.value), 80));
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); searchInput.focus(); }
  });

  // ---- create ----
  const canCreate = ctx.settings.allowPersonalLinks && !ctx.isLocked('personalLinks') && R.isValidKey(key);
  let createCard = null;
  if (canCreate) {
    const fields = personalLinkFields({
      link: { key }, shortHost,
      isTaken: (k) => {
        const c = R.lookup(index, k);
        return c ? `${shortHost}/${k} already exists (${c.title}).` : null;
      },
    });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, icon('plus'), 'Create & open');
    createCard = h('form', { class: 'card nf-create', onsubmit: async (e) => {
      e.preventDefault();
      const v = fields.validate();
      if (!v) return;
      btn.disabled = true;
      try {
        await send('savePersonalLink', { link: v });
        toast(`Created ${shortHost}/${v.key}`, { tone: 'success' });
        const r = await send('resolve', { input: v.key === key ? input : v.key });
        if (r.found) location.replace(r.url);
      } catch (err) {
        fields.showError(err.message);
      } finally { btn.disabled = false; }
    } },
    h('h3', {}, icon('plus', { size: 18, class: 'text-primary' }), `Create ${shortHost}/${key}`),
    h('p', { class: 'subtle mt-4' }, 'Make it a personal link, just for you in this browser. To add it for everyone, ask the link owner for your department.'),
    h('div', { class: 'mt-16' }, fields.el),
    h('div', { class: 'mt-16' }, btn));
  }

  const missingLabel = `${shortHost}/${input.length > 60 ? `${input.slice(0, 60)}…` : decodeSafe(input.replace(/^\/+/, ''))}`;
  const hero = h('section', { class: 'hero nf-hero' }, h('div', { class: 'hero-inner' },
    h('div', { class: 'eyebrow' }, brandMark(ctx.brand), `${ctx.brand.companyName} go-links`),
    h('h1', {}, h('span', { class: 'missing' }, missingLabel), h('span', {}, 'isn’t a link yet')),
    h('p', { class: 'lead' }, 'Nobody has created this go-link. Pick one of the suggestions below, search the directory, or create it for yourself.'),
    h('div', { class: 'search-box' }, icon('search'), searchInput, h('kbd', {}, '/'))));

  const side = h('aside', { class: 'stack nf-side' },
    createCard,
    h('div', { class: 'card' },
      h('h3', { class: 'row' }, icon('bookmark', { size: 18 }), 'Explore the directory'),
      h('p', { class: 'subtle mt-4' }, `${data.links.length} links from every department in one place.`),
      h('div', { class: 'row wrap mt-12' },
        h('a', { class: 'btn soft', href: 'directory.html' }, icon('grid'), 'Open directory'),
        h('a', { class: 'btn ghost', href: 'options.html' }, icon('settings'), 'Settings'))),
    res.error ? h('div', { class: 'callout warning' }, icon('alert'), h('div', {}, 'Could not reach the Go-Links service: ', res.error)) : null);

  $('#main').replaceChildren(hero, h('div', { class: 'nf-body' }, h('div', { class: 'nf-layout' },
    h('div', { class: 'stack' }, resultsTitle, results), side)));
  renderResults('');
  (createCard && !(res.suggestions || []).length ? createCard.querySelector('input[type="url"]') : searchInput).focus();
}

function decodeSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }
