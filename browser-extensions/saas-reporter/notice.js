// Unsanctioned-app banner. Injected on demand (scripting.executeScript) into the
// one tab that opened an app IT has not approved, after shared/content-ui.js.
// The background then calls globalThis.__saasNotice(data, brand).
(() => {
  if (globalThis.__saasNotice) return;

  const CSS = `
  .saas-notice { position: fixed; top: 16px; right: 16px; width: min(380px, calc(100vw - 32px)); pointer-events: auto;
    background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: calc(var(--radius, 10px) * 1.3);
    box-shadow: var(--shadow); overflow: hidden; animation: saas-in .28s cubic-bezier(.2,.8,.2,1); }
  .saas-notice.leaving { animation: saas-out .2s ease forwards; }
  .saas-notice .bar { height: 4px; background: linear-gradient(90deg, var(--warning), color-mix(in srgb, var(--warning) 40%, var(--brand-primary))); }
  .saas-notice .top { display: flex; align-items: center; gap: 8px; padding: 12px 12px 0 16px; color: var(--text-3); font-size: 11.5px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; }
  .saas-notice .top span.who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .saas-notice .x { border: 0; background: transparent; color: var(--text-3); width: 28px; height: 28px; border-radius: 6px; cursor: pointer; display: grid; place-items: center; }
  .saas-notice .x:hover { background: var(--surface-2); color: var(--text); }
  .saas-notice .x:focus-visible, .saas-notice a:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-primary) 32%, transparent); }
  .saas-notice .x svg { width: 15px; height: 15px; }
  .saas-notice .main { display: flex; gap: 12px; padding: 8px 16px 4px; }
  .saas-notice .ico { width: 36px; height: 36px; flex: none; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--warning) 16%, transparent); color: var(--warning); }
  .saas-notice .ico svg { width: 19px; height: 19px; }
  .saas-notice h2 { margin: 0; font-size: 15px; line-height: 1.35; font-weight: 680; color: var(--text); }
  .saas-notice p { margin: 4px 0 0; font-size: 13px; color: var(--text-2); line-height: 1.45; }
  .saas-notice .acts { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 16px 14px; flex-wrap: wrap; }
  .saas-notice a.btn { font: inherit; font-size: 13px; font-weight: 620; height: 32px; padding: 0 13px; border-radius: var(--radius-sm, 6px); display: inline-flex; align-items: center; text-decoration: none; cursor: pointer; }
  .saas-notice a.primary { background: var(--brand-primary); color: var(--brand-on-primary); }
  .saas-notice a.primary:hover { background: color-mix(in srgb, var(--brand-primary) 86%, #000); }
  .saas-notice a.ghost { color: var(--text-2); }
  .saas-notice a.ghost:hover { background: var(--surface-2); color: var(--text); }
  @keyframes saas-in { from { opacity: 0; transform: translateY(-8px) scale(.98); } }
  @keyframes saas-out { to { opacity: 0; transform: translateY(-6px); } }
  @media (prefers-reduced-motion: reduce) { .saas-notice, .saas-notice.leaving { animation: none; } }
  `;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const ICONS = {
    x: ['M6 6l12 12M18 6 6 18'],
    shield: ['M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3z', 'M12 8.5v4M12 15.5h.01'],
  };
  const svgEl = (name) => {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const d of ICONS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
    return svg;
  };

  let current = null;

  globalThis.__saasNotice = (data, brand) => {
    if (!globalThis.WX || !data) return;
    WX.setBrand(brand);
    if (!globalThis.__saasNoticeStyled) { WX.addStyle(CSS); globalThis.__saasNoticeStyled = true; }
    current?.close();

    const box = el('div', 'saas-notice');
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.append(el('div', 'bar'));

    const top = el('div', 'top');
    const mark = el('span', 'mark');
    const b = WX.getBrand();
    if (b.logo) { mark.classList.add('logo'); const img = el('img'); img.alt = ''; img.src = b.logo; mark.append(img); }
    else mark.textContent = String(b.companyName || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const close = el('button', 'x');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.append(svgEl('x'));
    top.append(mark, el('span', 'who', `${data.company} · IT notice`), close);

    const main = el('div', 'main');
    const ico = el('span', 'ico');
    ico.append(svgEl('shield'));
    const text = el('div');
    text.append(el('h2', null, `${data.appName} isn't approved by ${data.company}${/[.!]$/.test(data.company) ? '' : '.'}`));
    const alt = data.alternative;
    text.append(el('p', null, alt?.name
      ? `Try ${alt.name} instead. It's supported by IT and keeps company data in approved systems.`
      : 'Please use a company-approved tool for work data. Contact IT if you need this app.'));
    main.append(ico, text);

    const acts = el('div', 'acts');
    if (data.learnMoreUrl) {
      const more = el('a', 'btn ghost', 'Why?');
      more.href = data.learnMoreUrl; more.target = '_blank'; more.rel = 'noopener';
      acts.append(more);
    }
    if (alt?.url) {
      const go = el('a', 'btn primary', `Open ${alt.name || 'alternative'}`);
      go.href = alt.url; go.target = '_blank'; go.rel = 'noopener';
      acts.append(go);
    }
    box.append(top, main);
    if (acts.childNodes.length) box.append(acts);
    else main.style.paddingBottom = '14px';

    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    function dismiss() {
      document.removeEventListener('keydown', onKey, true);
      box.classList.add('leaving');
      setTimeout(() => box.remove(), 200);
      current = null;
    }
    close.addEventListener('click', dismiss);
    document.addEventListener('keydown', onKey, true);
    WX.mount(box);
    current = { close: dismiss };
  };
})();
