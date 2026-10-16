# Shared layer

> Edit files here, then run `npm run sync`. That copies this folder into every
> extension (`<ext>/shared/`) so each extension folder loads unpacked with no build step.

Every extension gets a copy of this folder at `shared/` in its build output
(`dist/<browser>/<ext>/shared/…`), so pages reference it as `shared/ui.css`,
`shared/page.js` and so on, relative to the extension root. Keep extension pages
at the extension root (`popup.html`, `options.html`, …) so these paths work.

All files except `content-ui.js` are ES modules. Pages load them with
`<script type="module" src="popup.js">`, and the background service worker is
declared with `"type": "module"`.

## Files

| File | What it gives you |
|---|---|
| `browser.js` | `api` (the `browser`/`chrome` namespace), `IS_FIREFOX`, `extUrl(path)`, `extVersion()`, `openOptions()`, `openExtensionPage(path)`, `uuid()` |
| `config.js` | Layered settings: `loadSettings(defaults)`, `saveSettings(patch)`, `onSettingsChanged(cb)`, `readManaged()`; data storage: `dataStore.get/set/update/remove`; `getInstallId()`, `fetchWithTimeout(url, opts, ms)`, `ensureHostPermission(url)`, `originPattern(url)` |
| `brand.js` | `normalizeBrand`, `applyBrand(brand)`, `brandForContent(brand)` (brand with the logo inlined, for content scripts), `contrastText`, `logoUrl`, `monogram`, `BRAND_PRESETS` |
| `messaging.js` | `handleMessages({ type: async (data, sender) => result })` in the background; `send(type, data)` from pages |
| `domain.js` | `hostOf(url)`, `registrableDomain(host)`, `matchHost(host, pattern)`, `matchUrl(url, pattern)`, `firstMatch(url, patterns)`, `globToRegExp`, `isRestrictedUrl(url)` |
| `env-info.js` | `getEnvironmentInfo()` returns browser, version, OS, arch, language, timezone, screen size and a `summary` string |
| `ui.js` | `h(tag, attrs, ...children)`, `$`, `$$`, `render`, `icon(name)`, `hydrateIcons()`, `toast()`, `dialog()`, `confirmDialog()`, `promptDialog()`, `copyText`, `downloadFile`, `pickFile`, `readFile`, `relativeTime`, `formatDateTime`, `formatNumber`, `formatDuration`, `debounce`, `escapeHtml`, `faviconFor`, `sortableHeaders` |
| `page.js` | `initPage({ defaults, title, options })` bootstraps any page (brand, header, footer, icons, live updates, save bar); also `renderHeader`, `renderFooter`, `brandMark` |
| `settings-ui.js` | Options-page kit: `bindSettings(root, ctx)`, `mountBrandingPanel(el, ctx)`, `mountBackupPanel(el, ctx, { secretKeys, slug })`, `mountAboutPanel(el, ctx, { description, privacy })`, `initSideNav()`, `sectionHead()`, `lockChip()` |
| `ui.css` | Design system (light and dark themes, all colours derived from the brand) |
| `content-ui.js` | Classic script for content scripts: `WX.send`, `WX.setBrand`, `WX.modal`, `WX.toast`, `WX.root`, `WX.mount`, `WX.addStyle` (everything renders in a closed shadow root) |
| `brand.json` | Written by the build from `brand/brand.json`. Don't edit it in `shared/` |

## Settings model

`loadSettings(DEFAULTS)` merges these layers, with later layers winning:

1. the extension's `DEFAULTS`
2. the brand kit baked into the build, as `settings.brand`
3. the managed policy's `defaults` object (IT suggestions the user can change)
4. the user's saved settings (`storage.local["settings"]`)
5. every other managed-policy key (IT-enforced and locked in the UI)

Top-level keys whose default is a plain object (`brand`, for example) are
merged one level deep. `ctx.isLocked('brand.primary')` reports locks. Save with
`saveSettings({ key: value })`, which replaces each top-level key you pass.

Use `dataStore` for logs, caches and counters, not settings. It lives under
separate storage keys, so import, export and reset never touch it.

## Page skeletons

Popup:

```html
<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="shared/ui.css"><link rel="stylesheet" href="popup.css">
<script type="module" src="popup.js"></script></head>
<body class="popup"><header id="app-header"></header><main id="main"></main><footer id="app-footer"></footer></body></html>
```

```js
import { initPage } from './shared/page.js';
const ctx = await initPage({ defaults: DEFAULTS, title: 'Go-Links' });
```

Options page, which gets a sticky save bar, Ctrl/Cmd+S, live brand preview and policy locks:

```html
<body>
  <header id="app-header"></header>
  <div class="shell">
    <nav class="side-nav">
      <div class="nav-label">Settings</div>
      <a href="#general"><i data-icon="settings"></i>General</a>
      <a href="#branding"><i data-icon="palette"></i>Branding</a>
      <a href="#backup"><i data-icon="download"></i>Backup &amp; policy</a>
      <a href="#about"><i data-icon="info"></i>About</a>
    </nav>
    <main class="content">
      <section id="general">
        <div class="section-head"><h2>General</h2><p>…</p></div>
        <div class="card">
          <div class="setting-row">
            <div class="text"><strong>Enabled</strong><span>Explain what it does.</span></div>
            <div class="control"><label class="switch"><input type="checkbox" data-setting="enabled"><span class="track"></span></label></div>
          </div>
        </div>
      </section>
      <section id="branding"><div class="section-head"><h2>Branding</h2></div><div id="branding-panel"></div></section>
      <section id="backup"><div class="section-head"><h2>Backup &amp; policy</h2></div><div id="backup-panel"></div></section>
      <section id="about"><div class="section-head"><h2>About</h2></div><div id="about-panel"></div></section>
    </main>
  </div>
</body>
```

```js
const ctx = await initPage({ defaults: DEFAULTS, title: 'Ticket Snap · Settings', options: true });
bindSettings(document, ctx);                 // all [data-setting] fields
mountBrandingPanel($('#branding-panel'), ctx);
mountBackupPanel($('#backup-panel'), ctx, { slug: 'ticket-snap', secretKeys: ['apiToken'] });
mountAboutPanel($('#about-panel'), ctx, { description: '…', privacy: '…' });
initSideNav();
// For custom editors (rule tables, link lists, …):
ctx.registerCollector(() => ({ rules: currentRules }));   // merged into the save
ctx.markDirty();                                          // after each edit
ctx.registerValidator((patch) => problem ? 'Message' : null);
```

`data-type` on bound fields can be `bool`, `number`, `text` (the default),
`lines` (array, one item per line), `csv` or `json`.

## Content scripts

List `shared/content-ui.js` before your own script in the manifest:

```json
"content_scripts": [{ "matches": ["<all_urls>"], "js": ["shared/content-ui.js", "content.js"], "run_at": "document_start" }]
```

The background should answer a message with `brandForContent(settings.brand)`,
and the content script then calls `WX.setBrand(brand)` before showing any UI.

## Icons

`icon('name')` or `<i data-icon="name"></i>`. Available names: search,
settings, plus, minus, trash, edit, external, copy, check, x, alert, info, help,
shield, shield-check, shield-alert, lock, unlock, camera, image, upload,
download, link, chart, activity, tag, flag, chevron-right, chevron-left,
chevron-down, arrow-right, arrow-up-right, refresh, eye, eye-off, globe, star,
sun, moon, palette, building, users, user, file, file-text, pen, square,
circle, type, highlighter, redact, undo, redo, crop, send, clock, calendar,
home, list, grid, server, layers, zap, filter, more, grip, mail, ticket, key,
power, cloud, code, bookmark, sparkle, rocket, slash.
