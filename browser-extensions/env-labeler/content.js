// Environment Labeler content script (classic script, top frame only).
// Ribbon, border, favicon tint, title prefix and production form guards.
(() => {
  if (globalThis.__envLabeler) return;
  globalThis.__envLabeler = true;
  if (!globalThis.WX) return;

  const api = WX.api;
  const HIDE_KEY = 'envLabeler:hidden';
  const DESTRUCTIVE = /\b(delete|drop|destroy|remove|truncate|purge|deploy)\b/i;

  let current = null; // { rule, prefs }
  let lastUrl = location.href;
  let lastKey = '';
  let ui = null; // { wrap, style }
  let titleObserver = null;
  let headObserver = null;
  let pushedPadding = null;
  let faviconToken = 0;
  const allowSubmit = new WeakSet();
  const allowClick = new WeakSet();

  // -------------------------------------------------------------------------
  // Matching
  // -------------------------------------------------------------------------
  async function evaluate(force = false) {
    let res;
    try { res = await WX.send('match', { url: location.href }); } catch { return; }
    if (res.brand) WX.setBrand(res.brand);
    const key = JSON.stringify([res.rule, res.prefs]);
    if (!force && key === lastKey) return;
    lastKey = key;
    current = res.rule ? { rule: res.rule, prefs: res.prefs } : null;
    applyAll();
  }

  function applyAll() {
    renderRibbon();
    whenDom(() => { applyTitle(); applyFavicon(); });
  }

  function whenDom(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  // -------------------------------------------------------------------------
  // Ribbon + border (inside the shared closed shadow root)
  // -------------------------------------------------------------------------
  const CSS = `
  .env { position: fixed; pointer-events: none; font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; letter-spacing: .02em; }
  .env * { box-sizing: border-box; }
  .env .bar { position: fixed; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--env-bg); color: var(--env-fg); opacity: var(--env-op); box-shadow: 0 1px 6px rgb(0 0 0 / .22); white-space: nowrap; overflow: hidden; }
  .env .bar .ico { display: inline-grid; place-items: center; width: 16px; height: 16px; flex: none; }
  .env .bar .ico svg { width: 14px; height: 14px; }
  .env .txt { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .env .lbl { font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .env .host { font-weight: 550; opacity: .85; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11.5px; letter-spacing: 0; overflow: hidden; text-overflow: ellipsis; }
  .env .sep { width: 4px; height: 4px; border-radius: 50%; background: currentColor; opacity: .55; flex: none; }
  .env .x { pointer-events: auto; cursor: pointer; border: 0; margin: 0; padding: 0; background: transparent; color: inherit; opacity: .7; width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center; flex: none; }
  .env .x:hover { opacity: 1; background: rgb(0 0 0 / .14); }
  .env .x:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; opacity: 1; }
  .env .x svg { width: 12px; height: 12px; }

  .env.top .bar, .env.bottom .bar { left: 0; right: 0; height: var(--env-h); padding: 0 34px; }
  .env.top .bar { top: 0; }
  .env.bottom .bar { bottom: 0; box-shadow: 0 -1px 6px rgb(0 0 0 / .22); }
  .env.top .x, .env.bottom .x { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); }

  .env.left .bar, .env.right .bar { top: 0; bottom: 0; width: var(--env-h); flex-direction: column; padding: 30px 0 12px; }
  .env.left .bar { left: 0; } .env.right .bar { right: 0; }
  .env.left .txt, .env.right .txt { writing-mode: vertical-rl; display: flex; align-items: center; gap: 8px; }
  .env.left .txt { transform: rotate(180deg); }
  .env.left .x, .env.right .x { position: absolute; top: 6px; left: 50%; transform: translateX(-50%); }

  .env.corner .bar { top: calc(var(--env-h) * 1.15); right: calc(var(--env-h) * -2.6); width: calc(var(--env-h) * 9.6); height: var(--env-h); transform: rotate(45deg); gap: 6px; padding: 0 22px; }
  .env.corner .host { display: none; }
  .env.corner .x { width: 16px; height: 16px; }

  .env .frame { position: fixed; inset: 0; box-shadow: inset 0 0 0 4px var(--env-bg); opacity: var(--env-op); }
  @media print { .env { display: none !important; } }
  `;

  function hiddenForSession() {
    try { return sessionStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
  }
  function setHidden(v) {
    try { if (v) sessionStorage.setItem(HIDE_KEY, '1'); else sessionStorage.removeItem(HIDE_KEY); } catch { /* storage blocked */ }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  const ICONS = {
    server: [['rect', { x: 3, y: 4, width: 18, height: 7, rx: 1.5 }], ['rect', { x: 3, y: 13, width: 18, height: 7, rx: 1.5 }], ['path', { d: 'M7 7.5h.01M7 16.5h.01' }]],
    x: [['path', { d: 'M6 6l12 12M18 6 6 18' }]],
  };
  function svgNode(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    for (const [tag, attrs] of ICONS[name]) {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      svg.append(n);
    }
    return svg;
  }

  function removeRibbon() {
    ui?.wrap?.remove();
    if (ui) ui.wrap = null;
    restorePadding();
  }

  function restorePadding() {
    if (pushedPadding !== null) {
      document.documentElement.style.paddingTop = pushedPadding;
      pushedPadding = null;
    }
  }

  function renderRibbon() {
    if (!ui) { ui = { style: WX.addStyle(CSS), wrap: null }; }
    removeRibbon();
    if (!current) return;
    const { rule, prefs } = current;
    const showBar = rule.ribbon !== 'none' && !hiddenForSession();
    if (!showBar && !rule.border) return;

    const pos = rule.ribbon === 'none' ? 'top' : rule.ribbon;
    const wrap = el('div', `env ${pos}`);
    wrap.setAttribute('role', 'note');
    wrap.setAttribute('aria-label', `${rule.label} environment`);
    wrap.style.setProperty('--env-bg', rule.color);
    wrap.style.setProperty('--env-fg', rule.textColor);
    wrap.style.setProperty('--env-op', String(prefs.ribbonOpacity));
    wrap.style.setProperty('--env-h', `${prefs.ribbonHeight}px`);

    if (rule.border) wrap.append(el('div', 'frame'));

    if (showBar) {
      const bar = el('div', 'bar');
      const txt = el('span', 'txt');
      const ico = el('span', 'ico');
      ico.append(svgNode('server'));
      txt.append(ico, el('span', 'lbl', rule.label));
      if (prefs.showHostname && pos !== 'corner') txt.append(el('span', 'sep'), el('span', 'host', location.host));
      bar.append(txt);
      if (prefs.allowHideRibbon) {
        const x = el('button', 'x');
        x.type = 'button';
        x.title = 'Hide the label for this tab';
        x.setAttribute('aria-label', 'Hide environment label for this tab');
        x.append(svgNode('x'));
        x.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          setHidden(true);
          renderRibbon();
          WX.toast(`${rule.label} label hidden for this tab`, {
            tone: 'info', timeout: 5000,
            action: { label: 'Undo', onClick: () => { setHidden(false); renderRibbon(); } },
          });
        });
        bar.append(x);
      }
      wrap.append(bar);
      if (pos === 'top' && prefs.ribbonPushesContent && document.documentElement) {
        pushedPadding = document.documentElement.style.paddingTop || '';
        document.documentElement.style.paddingTop = `${prefs.ribbonHeight}px`;
      }
    }
    ui.wrap = WX.mount(wrap);
  }

  // -------------------------------------------------------------------------
  // Title prefix
  // -------------------------------------------------------------------------
  let appliedPrefix = '';
  const strip = (t) => (appliedPrefix && t.startsWith(appliedPrefix) ? t.slice(appliedPrefix.length) : t);

  function applyTitle() {
    const want = current?.rule.titlePrefix ? `[${current.rule.short}] ` : '';
    const base = strip(document.title);
    appliedPrefix = want;
    const next = want + base;
    if (document.title !== next) document.title = next;
    watchTitle(!!want);
  }

  function watchTitle(on) {
    if (!on) { titleObserver?.disconnect(); titleObserver = null; return; }
    if (titleObserver) return;
    titleObserver = new MutationObserver(() => {
      if (!appliedPrefix) return;
      if (!document.title.startsWith(appliedPrefix)) document.title = appliedPrefix + document.title;
    });
    const target = document.head || document.documentElement;
    titleObserver.observe(target, { subtree: true, childList: true, characterData: true });
  }

  // -------------------------------------------------------------------------
  // Favicon tint
  // -------------------------------------------------------------------------
  const OUR = 'data-env-labeler';
  const ORIG = 'data-env-labeler-rel';

  function pageIconLinks() {
    return [...document.querySelectorAll(`link[rel~="icon" i]:not([${OUR}]), link[${ORIG}]`)];
  }

  function sourceIconUrl() {
    const links = pageIconLinks();
    const pick = links.find((l) => /\bicon\b/i.test(l.getAttribute(ORIG) || l.rel) && l.href) || links[0];
    if (pick?.href) return pick.href;
    return /^https?:/.test(location.protocol) ? `${location.origin}/favicon.ico` : '';
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const t = setTimeout(() => resolve(null), 4000);
      img.onload = () => { clearTimeout(t); resolve(img.naturalWidth ? img : null); };
      img.onerror = () => { clearTimeout(t); resolve(null); };
      img.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  async function tintedIcon(rule) {
    const S = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = S;
    const ctx = canvas.getContext('2d');
    const img = await loadImage(sourceIconUrl());
    let drew = false;
    if (img) {
      try {
        ctx.drawImage(img, 0, 0, S, S);
        canvas.toDataURL(); // throws if tainted
        drew = true;
      } catch { ctx.clearRect(0, 0, S, S); }
    }
    if (drew) {
      // Coloured band along the bottom with a light separator.
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fillRect(0, S - 22, S, 2);
      ctx.fillStyle = rule.color;
      ctx.fillRect(0, S - 20, S, 20);
      ctx.fillStyle = rule.textColor;
      ctx.font = `800 ${rule.short.length > 3 ? 13 : 16}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(rule.short.slice(0, 4), S / 2, S - 9.5);
    } else {
      ctx.fillStyle = rule.color;
      roundRect(ctx, 2, 2, S - 4, S - 4, 14);
      ctx.fill();
      ctx.fillStyle = rule.textColor;
      ctx.font = '800 38px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((rule.label.trim()[0] || '?').toUpperCase(), S / 2, S / 2 + 2);
    }
    return canvas.toDataURL('image/png');
  }

  function restoreFavicon() {
    document.querySelectorAll(`link[${OUR}]`).forEach((l) => l.remove());
    document.querySelectorAll(`link[${ORIG}]`).forEach((l) => { l.rel = l.getAttribute(ORIG); l.removeAttribute(ORIG); });
  }

  async function applyFavicon() {
    const token = ++faviconToken;
    if (!current?.rule.faviconTint) { stopHeadWatch(); restoreFavicon(); return; }
    const data = await tintedIcon(current.rule);
    if (token !== faviconToken || !document.head) return;
    stopHeadWatch();
    // Park the page's own icons (kept in the DOM so page scripts can still update them).
    for (const l of document.querySelectorAll(`link[rel~="icon" i]:not([${OUR}])`)) {
      l.setAttribute(ORIG, l.rel);
      l.rel = 'env-labeler-original-icon';
    }
    let ours = document.querySelector(`link[${OUR}]`);
    if (!ours) {
      ours = document.createElement('link');
      ours.setAttribute(OUR, '');
      ours.rel = 'icon';
    }
    ours.type = 'image/png';
    ours.href = data;
    document.head.append(ours);
    startHeadWatch();
  }

  let faviconTimer = 0;
  function startHeadWatch() {
    if (headObserver || !document.head) return;
    headObserver = new MutationObserver((records) => {
      const relevant = records.some((r) => {
        if (r.type === 'attributes') return r.target.tagName === 'LINK' && !r.target.hasAttribute(OUR);
        return [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeName === 'LINK');
      });
      if (!relevant) return;
      clearTimeout(faviconTimer);
      faviconTimer = setTimeout(applyFavicon, 60);
    });
    headObserver.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });
  }
  function stopHeadWatch() { headObserver?.disconnect(); headObserver = null; }

  // -------------------------------------------------------------------------
  // Production guards: form submits and destructive clicks
  // -------------------------------------------------------------------------
  let guardOpen = false;

  async function confirmAction(kind, detail) {
    if (guardOpen) return false;
    guardOpen = true;
    try {
      const { rule } = current;
      const res = await WX.modal({
        tone: 'danger',
        icon: 'alert',
        product: 'Environment Labeler',
        title: `You're about to ${kind} on ${rule.label}`,
        message: 'This is a live environment. Double-check before you continue.',
        details: [
          { label: 'Environment', value: rule.label },
          { label: 'Site', value: location.host },
          ...(detail ? [{ label: kind === 'submit' ? 'Form' : 'Action', value: detail }] : []),
        ],
        actions: [
          { label: 'Cancel', value: 'cancel' },
          { label: kind === 'submit' ? 'Submit anyway' : 'Continue anyway', value: 'go', variant: 'danger' },
        ],
        dismissValue: 'cancel',
      });
      return res.value === 'go';
    } finally {
      guardOpen = false;
    }
  }

  function describeForm(form, submitter) {
    const text = (submitter?.textContent || submitter?.value || '').trim();
    const action = form.getAttribute('action') || '';
    let path = '';
    try { path = action ? new URL(action, location.href).pathname : ''; } catch { /* ignore */ }
    return [text && `"${text.slice(0, 40)}"`, path].filter(Boolean).join(' → ');
  }

  window.addEventListener('submit', (e) => {
    if (!current?.rule.confirmForms) return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (allowSubmit.has(form)) { allowSubmit.delete(form); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    const submitter = e.submitter || null;
    confirmAction('submit', describeForm(form, submitter)).then((go) => {
      if (!go) return;
      allowSubmit.add(form);
      try {
        if (typeof form.requestSubmit === 'function') form.requestSubmit(submitter && submitter.form === form ? submitter : undefined);
        else form.submit();
      } catch {
        form.submit();
      }
    });
  }, true);

  function clickLabel(target) {
    const t = target.closest?.('button, input[type="submit"], input[type="button"], a, [role="button"], [role="menuitem"]');
    if (!t) return null;
    const text = [t.getAttribute('aria-label'), t.value, t.textContent, t.title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return DESTRUCTIVE.test(text) ? { el: t, text: text.slice(0, 60) } : null;
  }

  window.addEventListener('click', (e) => {
    if (!current?.rule.confirmForms || !current.prefs.confirmDestructiveClicks) return;
    if (!e.isTrusted || e.button !== 0) return;
    const hit = clickLabel(e.target);
    if (!hit) return;
    if (allowClick.has(hit.el)) { allowClick.delete(hit.el); return; }
    e.preventDefault();
    e.stopImmediatePropagation();
    confirmAction('do this', hit.text).then((go) => {
      if (!go) return;
      allowClick.add(hit.el);
      if (hit.el.form) allowSubmit.add(hit.el.form);
      hit.el.click();
      // `click()` events are untrusted, so the guard above lets them through;
      // clear the flags in case the page ignored the click.
      setTimeout(() => { allowClick.delete(hit.el); if (hit.el.form) allowSubmit.delete(hit.el.form); }, 1000);
    });
  }, true);

  // -------------------------------------------------------------------------
  // SPA navigation, background pushes, popup commands
  // -------------------------------------------------------------------------
  function checkUrl() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    evaluate();
  }
  window.addEventListener('popstate', checkUrl);
  window.addEventListener('hashchange', checkUrl);
  let poll = 0;
  function syncPoll() {
    clearInterval(poll);
    if (document.visibilityState === 'visible') poll = setInterval(checkUrl, 1000);
  }
  document.addEventListener('visibilitychange', () => { syncPoll(); if (document.visibilityState === 'visible') checkUrl(); });
  syncPoll();

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('env:')) return false;
    if (msg.type === 'env:refresh') { evaluate(); sendResponse({ ok: true }); return false; }
    if (msg.type === 'env:state') {
      sendResponse({ ok: true, data: { url: location.href, hidden: hiddenForSession(), rule: current?.rule || null } });
      return false;
    }
    if (msg.type === 'env:hide' || msg.type === 'env:show') {
      setHidden(msg.type === 'env:hide');
      renderRibbon();
      sendResponse({ ok: true, data: { hidden: hiddenForSession() } });
      return false;
    }
    return false;
  });

  evaluate(true);
})();
