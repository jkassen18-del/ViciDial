// Branded UI for content scripts (classic script, not a module).
// Everything renders inside a closed shadow root so page CSS cannot leak in
// and our styles cannot break the page.
//
//   WX.send(type, data)                     -> Promise (background message, unwrapped)
//   WX.setBrand(brand)                      brand from brandForContent() in the background
//   WX.modal({ title, message, tone, product, details, input, actions }) -> Promise<{ value, input }>
//   WX.toast(message, { tone, timeout, action: { label, onClick } })
//   WX.mount(node) / WX.root()              attach custom UI to the shared shadow root
(() => {
  if (globalThis.WX) return;
  const api = globalThis.browser ?? globalThis.chrome;

  async function send(type, data) {
    const res = await api.runtime.sendMessage({ type, data });
    if (!res) throw new Error(`No handler for "${type}"`);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  }

  let brand = { companyName: '', logo: '', theme: 'auto', cssVars: {} };
  let host, shadow, layer;

  const CSS = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: var(--text); -webkit-font-smoothing: antialiased; }
  .layer * { box-sizing: border-box; }
  .light { --bg:#f5f6fa; --surface:#fff; --surface-2:#f2f4f8; --border:#e2e5ee; --border-strong:#cdd2de; --text:#0f172a; --text-2:#475569; --text-3:#64748b; --danger:#dc2626; --warning:#b45309; --success:#15803d; --info:#2563eb; --overlay: rgb(15 23 42 / .5); --shadow: 0 20px 50px rgb(15 23 42 / .25), 0 4px 12px rgb(15 23 42 / .1); }
  .dark { --bg:#0b0f19; --surface:#121826; --surface-2:#182032; --border:#253049; --border-strong:#34405c; --text:#e8ecf5; --text-2:#a9b3c8; --text-3:#8591a9; --danger:#f87171; --warning:#fbbf24; --success:#4ade80; --info:#60a5fa; --overlay: rgb(0 0 0 / .62); --shadow: 0 20px 50px rgb(0 0 0 / .6); }
  .backdrop { position: fixed; inset: 0; background: var(--overlay); backdrop-filter: blur(3px); pointer-events: auto; display: grid; place-items: center; padding: 16px; animation: fade .18s ease; }
  .modal { width: min(500px, 100%); max-height: calc(100vh - 32px); overflow: auto; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: calc(var(--radius, 10px) * 1.4); box-shadow: var(--shadow); animation: pop .22s cubic-bezier(.2,.8,.2,1); }
  .tonebar { height: 4px; background: linear-gradient(90deg, var(--brand-primary), var(--brand-accent)); }
  .modal.danger .tonebar { background: var(--danger); }
  .modal.warning .tonebar { background: linear-gradient(90deg, var(--warning), color-mix(in srgb, var(--warning) 50%, var(--brand-primary))); }
  .head { display: flex; align-items: center; gap: 10px; padding: 14px 20px 0; color: var(--text-3); font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em; }
  .mark { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; overflow: hidden; flex: none; background: linear-gradient(135deg, var(--brand-primary), var(--brand-accent)); color: var(--brand-on-primary); font-size: 10px; font-weight: 800; letter-spacing: 0; }
  .mark img { width: 100%; height: 100%; object-fit: contain; }
  .mark.logo { background: transparent; }
  .body { padding: 12px 20px 4px; }
  .title { display: flex; gap: 12px; align-items: flex-start; }
  .ticon { width: 40px; height: 40px; border-radius: 50%; flex: none; display: grid; place-items: center; background: color-mix(in srgb, var(--brand-primary) 14%, transparent); color: var(--brand-primary); }
  .modal.danger .ticon { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger); }
  .modal.warning .ticon { background: color-mix(in srgb, var(--warning) 16%, transparent); color: var(--warning); }
  .modal.success .ticon { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
  .ticon svg { width: 21px; height: 21px; }
  h2 { margin: 0; font-size: 17px; line-height: 1.3; font-weight: 680; letter-spacing: -.01em; color: var(--text); }
  p.msg { margin: 6px 0 0; color: var(--text-2); font-size: 13.5px; }
  .details { margin: 14px 0 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: var(--radius, 10px); overflow: hidden; }
  .details li { display: flex; justify-content: space-between; gap: 12px; padding: 9px 12px; font-size: 13px; border-top: 1px solid var(--border); background: var(--surface-2); }
  .details li:first-child { border-top: 0; }
  .details .k { font-weight: 600; color: var(--text); }
  .details .v { color: var(--text-2); font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; text-align: right; overflow-wrap: anywhere; }
  label.lbl { display: block; font-weight: 600; font-size: 13px; margin: 14px 0 6px; color: var(--text); }
  textarea { width: 100%; min-height: 70px; resize: vertical; font: inherit; font-size: 13.5px; color: var(--text); background: var(--surface); border: 1px solid var(--border-strong); border-radius: var(--radius-sm, 6px); padding: 8px 10px; }
  textarea:focus { outline: none; border-color: var(--brand-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-primary) 30%, transparent); }
  .hint { font-size: 12px; color: var(--text-3); margin-top: 4px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px 18px; flex-wrap: wrap; }
  button.btn { font: inherit; font-size: 13.5px; font-weight: 620; height: 36px; padding: 0 15px; border-radius: var(--radius-sm, 6px); border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  button.btn:hover { background: var(--surface-2); }
  button.btn:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand-primary) 32%, transparent); }
  button.btn:disabled { opacity: .5; cursor: not-allowed; }
  button.primary { background: var(--brand-primary); color: var(--brand-on-primary); border-color: transparent; }
  button.primary:hover { background: color-mix(in srgb, var(--brand-primary) 86%, #000); }
  button.danger { background: var(--danger); color: #fff; border-color: transparent; }
  button.ghost { background: transparent; border-color: transparent; color: var(--text-2); }
  button.ghost:hover { background: var(--surface-2); color: var(--text); }
  .foot { padding: 0 20px 16px; font-size: 12px; color: var(--text-3); }
  .foot a { color: var(--text-2); }
  .toasts { position: fixed; right: 18px; bottom: 18px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
  .toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; max-width: 400px; padding: 10px 12px 10px 12px; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-left: 4px solid var(--brand-primary); border-radius: var(--radius, 10px); box-shadow: var(--shadow); font-size: 13px; font-weight: 550; animation: up .25s cubic-bezier(.2,.8,.2,1); }
  .toast.warning { border-left-color: var(--warning); } .toast.danger { border-left-color: var(--danger); } .toast.success { border-left-color: var(--success); }
  .toast button { font: inherit; font-size: 12.5px; font-weight: 650; border: 0; background: transparent; color: var(--brand-primary); cursor: pointer; padding: 4px 6px; border-radius: 5px; }
  .toast button:hover { background: var(--surface-2); }
  .toast .x { color: var(--text-3); }
  .leaving { animation: out .2s ease forwards; }
  @keyframes fade { from { opacity: 0; } }
  @keyframes pop { from { opacity: 0; transform: translateY(10px) scale(.97); } }
  @keyframes up { from { opacity: 0; transform: translateY(8px); } }
  @keyframes out { to { opacity: 0; transform: translateY(6px); } }
  `;

  const ICON = {
    shield: '<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6L12 3z"/><path d="M12 8.5v4M12 15.5h.01"/>',
    alert: '<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ICON.info}</svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function themeClass() {
    const t = brand.theme;
    if (t === 'light' || t === 'dark') return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function ensureHost() {
    if (host?.isConnected) return;
    host = document.createElement('wx-ui');
    host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; pointer-events: none !important; z-index: 2147483647 !important; display: block !important;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    layer = document.createElement('div');
    layer.className = 'layer';
    shadow.append(style, layer);
    applyVars();
    (document.documentElement || document).append(host);
  }

  function applyVars() {
    if (!layer) return;
    layer.className = `layer ${themeClass()}`;
    for (const [k, v] of Object.entries(brand.cssVars || {})) layer.style.setProperty(k, v);
  }

  function markHtml() {
    const initials = String(brand.companyName || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    return brand.logo
      ? `<span class="mark logo"><img alt="" src="${esc(brand.logo)}"></span>`
      : `<span class="mark">${esc(initials)}</span>`;
  }

  /**
   * opts: { title, message, tone: 'danger'|'warning'|'info'|'success', icon, product,
   *         details: [{ label, value }], input: { label, placeholder, required, hint },
   *         actions: [{ label, value, variant: 'primary'|'danger'|'ghost', requiresInput }],
   *         footer: string, dismissValue }
   */
  function modal(opts) {
    ensureHost();
    return new Promise((resolve) => {
      const tone = opts.tone || 'info';
      const back = document.createElement('div');
      back.className = 'backdrop';
      const iconName = opts.icon || (tone === 'danger' || tone === 'warning' ? 'shield' : tone === 'success' ? 'check' : 'info');
      const actions = opts.actions || [{ label: 'OK', value: true, variant: 'primary' }];
      const support = brand.supportUrl ? `<a href="${esc(brand.supportUrl)}" target="_blank" rel="noopener">Get help</a>` : brand.supportEmail ? `<a href="mailto:${esc(brand.supportEmail)}">${esc(brand.supportEmail)}</a>` : '';
      back.innerHTML = `
        <div class="modal ${tone}" role="alertdialog" aria-modal="true" aria-labelledby="t">
          <div class="tonebar"></div>
          <div class="head">${markHtml()}<span>${esc(brand.companyName)}${opts.product ? ' · ' + esc(opts.product) : ''}</span></div>
          <div class="body">
            <div class="title"><span class="ticon">${svg(iconName)}</span><div><h2 id="t">${esc(opts.title)}</h2>${opts.message ? `<p class="msg">${esc(opts.message)}</p>` : ''}</div></div>
            ${opts.details?.length ? `<ul class="details">${opts.details.map((d) => `<li><span class="k">${esc(d.label)}</span><span class="v">${esc(d.value)}</span></li>`).join('')}</ul>` : ''}
            ${opts.input ? `<label class="lbl" for="in">${esc(opts.input.label || 'Reason')}</label><textarea id="in" placeholder="${esc(opts.input.placeholder || '')}"></textarea>${opts.input.hint ? `<div class="hint">${esc(opts.input.hint)}</div>` : ''}` : ''}
          </div>
          <div class="actions">${actions.map((a, i) => `<button class="btn ${esc(a.variant || '')}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
          ${opts.footer || support ? `<div class="foot">${esc(opts.footer || '')}${opts.footer && support ? ' · ' : ''}${support}</div>` : ''}
        </div>`;
      const textarea = back.querySelector('textarea');
      const buttons = [...back.querySelectorAll('button[data-i]')];
      const sync = () => buttons.forEach((b) => {
        const a = actions[b.dataset.i];
        if (a.requiresInput && opts.input?.required) b.disabled = !textarea.value.trim();
      });
      textarea?.addEventListener('input', sync);
      sync();
      const finish = (value) => {
        document.removeEventListener('keydown', onKey, true);
        back.classList.add('leaving');
        setTimeout(() => back.remove(), 180);
        resolve({ value, input: textarea?.value.trim() || '' });
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); finish(opts.dismissValue ?? null); }
        if (e.key === 'Tab') { // keep focus inside the dialog
          const f = [textarea, ...buttons].filter((x) => x && !x.disabled);
          const i = f.indexOf(shadow.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
        }
        e.stopPropagation();
      };
      document.addEventListener('keydown', onKey, true);
      buttons.forEach((b) => b.addEventListener('click', () => finish(actions[b.dataset.i].value)));
      layer.append(back);
      setTimeout(() => (textarea || buttons.find((b) => b.classList.contains('primary')) || buttons[0])?.focus(), 30);
    });
  }

  let toasts;
  function toast(message, { tone = 'info', timeout = 4000, action } = {}) {
    ensureHost();
    if (!toasts?.isConnected) { toasts = document.createElement('div'); toasts.className = 'toasts'; layer.append(toasts); }
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.innerHTML = `${markHtml()}<span>${esc(message)}</span>`;
    if (action) {
      const b = document.createElement('button');
      b.textContent = action.label;
      b.addEventListener('click', () => { action.onClick?.(); close(); });
      el.append(b);
    }
    const x = document.createElement('button');
    x.className = 'x'; x.setAttribute('aria-label', 'Dismiss'); x.innerHTML = '&times;';
    x.addEventListener('click', close);
    el.append(x);
    toasts.append(el);
    let t = timeout ? setTimeout(close, timeout) : null;
    function close() { clearTimeout(t); el.classList.add('leaving'); setTimeout(() => el.remove(), 200); }
    return { close };
  }

  globalThis.WX = {
    api,
    send,
    setBrand(b) { brand = { ...brand, ...(b || {}) }; applyVars(); },
    getBrand: () => brand,
    modal,
    toast,
    escapeHtml: esc,
    svg,
    /** Shared closed shadow root, for custom overlays (ribbons, banners). */
    root() { ensureHost(); return { shadow, layer }; },
    mount(node) { ensureHost(); layer.append(node); return node; },
    addStyle(css) { ensureHost(); const s = document.createElement('style'); s.textContent = css; shadow.append(s); return s; },
  };
})();
