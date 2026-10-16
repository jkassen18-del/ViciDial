# Environment Labeler

Makes it hard to mix up **production** with **staging, QA or dev**. Every site that matches a rule gets:

- a **coloured ribbon** (top, bottom, left, right, diagonal corner, or none), drawn as an overlay that never blocks clicks
- a **tinted favicon** (a coloured band with the tag, e.g. `PROD`), so you can tell tabs apart
- a **title prefix** such as `[PROD] Customers`, kept in sync when the page changes its title
- an optional **page border**
- a **toolbar badge** (`PROD`, `STG`, `QA`, `DEV`…) in the rule's colour
- an optional **"are you sure?" confirmation** before forms are submitted, and optionally before clicking Delete / Drop / Destroy / Remove / Truncate / Purge / Deploy buttons

Works in Chrome, Edge and Firefox (≥ 128) from one Manifest V3 source tree.

## Features

| Area | What it does |
|---|---|
| Rules | Label, colour (presets or picker), automatic or custom text colour, optional tag, patterns, ribbon position, favicon/title/border/confirm toggles. First enabled matching rule wins. Drag or use the arrows to reorder. |
| Defaults | PRODUCTION (red, no patterns: the settings page asks you to add your prod hosts), STAGING (amber: `*staging*`, `stg.*`, `*.stg.*`, `*-stg.*`, `uat.*`, `*.uat.*`, `*-uat.*`, `*preprod*`), QA (blue: `qa.*`, `*.qa.*`, `*-qa.*`, `test.*`, `*.test.*`), DEV (green: `localhost`, `127.0.0.1`, `0.0.0.0`, `*.local`, `*.test`, `dev.*`, `*.dev.*`, `*-dev.*`) |
| Rule sources | **Company** rules (managed policy `rules`, read-only), then **Remote** rules (JSON files from `rulesUrls`, refreshed on startup and every `refreshMinutes`, cached with last-fetch status; a failed fetch keeps the last good copy), then **Personal** rules (when `allowPersonalRules`). Each rule shows its source badge. |
| Test a URL | Live box in settings that shows which rule wins, which pattern matched, and why the other rules did not (no match, rule off, or a higher rule wins). Uses unsaved edits. |
| Live preview | A mini browser window per rule shows the tab title, tinted favicon, badge, ribbon and border. |
| Popup | Big coloured card for the current site (label, host, matched pattern, source, active features), "Label this site as…" (pick a rule or create a new environment), hide/show the ribbon for this tab, remove a site label, and a compact list of rules. Actions are disabled with an explanation when rules are managed, personal rules are off, or a company/remote rule already labels the site. |
| SPA support | Re-checks the rule on `popstate`/`hashchange` and with a cheap 1 s `location.href` poll while the tab is visible. |
| Live updates | Settings changes are pushed to open tabs; ribbons, titles, favicons and badges update without reloading. |
| Branding | Company brand on the popup, settings page and the in-page confirmation dialog. |

### Pattern syntax

| Pattern | Matches |
|---|---|
| `app.example.com` | that host and all its subdomains |
| `=admin.example.com` | exactly that host |
| `*.prod.example.com` | subdomains only |
| `app-*.example.com`, `*staging*` | host glob (anchored on the whole host name) |
| `example.com/admin*` | host plus a path glob |
| `localhost:8080` | a specific port |
| `re:^https://[^/]+\.prd\.` | JavaScript regular expression on the full URL |

Pasting a full URL keeps just its host (and port/path).

## Try it

```bash
node tools/build.mjs --browsers chrome --only env-labeler
# Load dist/chrome/env-labeler as an unpacked extension.
node tools/dev-server.mjs            # serves http://localhost:8787/config/env-rules.json
```

1. Open any `http://localhost:…` page: it gets the green DEV corner ribbon.
2. Open the settings, add `localhost:3000` (or similar) under "Tell us which sites are production", save, and reload that page: red ribbon, `[PROD]` title, tinted favicon, red border, and a confirmation when submitting a form.
3. Under **Remote rule sources**, add `http://localhost:8787/config/env-rules.json` (the browser asks for access to localhost once) and save. The Acme rules appear as "Remote" rules.

## Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch |
| `rules` | array of rules | `[]` | Company rules. Set by policy; always read-only and evaluated first |
| `personalRules` | array of rules | the 4 defaults | The user's own rules (evaluated last) |
| `allowPersonalRules` | boolean | `true` | Use personal rules |
| `rulesUrls` | string[] | `[]` | Remote JSON rule files |
| `refreshMinutes` | integer | `60` | Remote refresh interval |
| `confirmDestructiveClicks` | boolean | `false` | Also confirm destructive-looking buttons on rules with `confirmForms` |
| `ribbonHeight` | integer | `26` | Ribbon thickness in px (16–48) |
| `ribbonOpacity` | number | `0.95` | 0.3–1 |
| `allowHideRibbon` | boolean | `true` | Show the × that hides the ribbon for the tab session |
| `ribbonPushesContent` | boolean | `false` | Add top padding to the page for a top ribbon |
| `showHostname` | boolean | `true` | Host name on the ribbon |
| `showBadge` | boolean | `true` | Toolbar badge |

Rule object: `{ id, label, color, textColor?, short?, patterns: [], ribbon: "top"|"bottom"|"left"|"right"|"corner"|"none", faviconTint, titlePrefix, border, confirmForms, enabled }`.
Remote files are `{ "name": "...", "rules": [ ...rules ] }` (a bare array also works). See `examples/env-rules.json`.

## Managed policy example

Chrome / Edge (`3rdparty.extensions.<extension id>`), Firefox (`policies.3rdparty.Extensions.<id>`):

```json
{
  "rules": [
    { "id": "prod", "label": "PRODUCTION", "color": "#DC2626",
      "patterns": ["app.acme.example", "admin.acme.example", "*.prod.acme.example"],
      "ribbon": "top", "faviconTint": true, "titlePrefix": true, "border": true, "confirmForms": true }
  ],
  "rulesUrls": ["https://config.acme.example/env-rules.json"],
  "refreshMinutes": 30,
  "allowPersonalRules": true,
  "defaults": { "confirmDestructiveClicks": true }
}
```

Keys outside `defaults` are enforced and shown locked; keys inside `defaults` are suggestions users can change. "Backup & policy → Generate policy" in the settings produces this JSON from your current configuration.

## Permissions

| Permission | Why |
|---|---|
| content script on `<all_urls>` (top frame, `document_start`) | Draw the ribbon/border, tint the favicon, prefix the title and guard form submits on matching sites. Pages with no matching rule are left untouched apart from a single local rule lookup. |
| `storage` | Settings, remote rule cache, per-tab state (`storage.session`) |
| `alarms` | Periodic refresh of remote rule sources |
| `activeTab` | Lets the popup read the current tab's address when you open it |
| optional `http://*/*`, `https://*/*` | Requested only for the host of a remote rule source you add, so the background can download it |

## Privacy

All matching happens locally. Page addresses are never sent anywhere or logged. The only network traffic is downloading the remote rule files you (or IT) configure, made without cookies. Firefox `data_collection_permissions` is `none`.

## Known limitations

- Form confirmation catches real `submit` events (buttons, Enter key, `requestSubmit`). Pages that call `form.submit()` directly or send data with `fetch` from a click handler are not intercepted; enable "Confirm destructive clicks" to cover common destructive buttons.
- Favicons from another origin without CORS headers cannot be read into a canvas; a coloured tile with the label's first letter is used instead.
- The ribbon is not shown in iframes, on browser pages (`chrome://`, `about:`), extension stores, or PDF viewers. Toolbar badges are set when the content script runs, so tabs opened before installing need a reload.
- Personal rules cannot override a site that a company or remote rule already labels (by design: they are evaluated first).
- `ribbonPushesContent` adds padding to `<html>`; page elements with `position: fixed` do not move.
- In Firefox, host access for content scripts can be withdrawn by the user in the add-on's permissions; labels then stop appearing on those sites.
