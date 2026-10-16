# SaaS Usage Reporter

Shadow-IT discovery and licence optimisation for Chrome, Edge and Firefox (MV3).
The extension records **which SaaS apps are used, by domain only**, and reports
anonymous per-app totals so IT can see unapproved tools and paid licences that sit
idle. It is transparent: every user can open the popup or dashboard and see exactly
what is stored.

## Features

- **Built-in catalog** of 330+ SaaS apps in 19 categories (`catalog.js`). Matching
  picks the most specific entry, so `mail.google.com` (Gmail), `docs.google.com`,
  `drive.google.com`, `meet.google.com`, `teams.microsoft.com`, `outlook.office.com`,
  `onedrive.live.com` and `*.sharepoint.com` beat the generic `google.com` /
  `microsoft.com` / `live.com` entries. Admins add `customApps`.
- **Classification**: approved (`sanctionedApps`), not approved (`unsanctionedApps`)
  with optional `alternatives`, or unclassified. The most specific pattern wins, so
  `google.com` approved + `mail.google.com` not approved works as expected.
- **Licences**: `licensedApps` (domain, name, seats) are flagged when not used for
  `licenseUnusedDays` (default 30).
- **Tracking**
  - *Visits* = sessions, not page views: a top-frame commit to an app counts once;
    further navigations in the same tab and app within 30 minutes are the same visit.
  - *Active time* = seconds the app is in the active tab of the focused window while
    the user is not idle (`idle` API, configurable threshold). The current segment is
    kept in `storage.session` and flushed on every tab/window/idle change and by a
    1-minute alarm. A single flush credits at most 3 minutes, so a sleeping laptop or
    a stopped service worker never produces runaway numbers. Time crossing midnight is
    split between the two days.
  - Scope `catalog` (default) records only catalog, custom and classified apps;
    `all-domains` records any registrable domain (still domain only).
  - Never recorded: `ignoreDomains`, localhost, IP addresses, single-label and private
    names (`.local`, `.corp`, `.internal`, `.lan`, …) unless an admin lists the host as
    a custom app, extension/browser pages, and private windows (`"incognito": "not_allowed"`
    plus a per-tab check).
  - Daily aggregates `usage:YYYY-MM-DD → { domain: { visits, activeSeconds } }` and
    `lastSeen` per app, pruned after `retentionDays` (default 90) by a twice-daily alarm.
- **Reporting** to `reportEndpoint` every `reportIntervalHours` (default 24) with a
  rolling window of `reportPeriodDays` (default 30). A 15-minute alarm checks whether a
  report is due; failures retry with exponential backoff (2, 4, 8 … minutes, capped at
  the interval / 6 hours). Last result is shown in the options page with a
  **Send report now** button.
- **Unapproved-app notice** (`notifyOnUnsanctioned: "notice"`): "WeTransfer isn't
  approved by Acme. Try OneDrive instead." with a link to the alternative and a "Why?"
  link, at most once per app per day. In-page branded card when the optional site
  permission is granted, otherwise a system notification (see Permissions).
- **Popup**: current-tab status card, this week's stats (apps, active time, not
  approved), top apps with favicon, category, status badge and time bar,
  "What is collected?" explanation, link to the dashboard.
- **Dashboard** (`dashboard.html`): 7/30/90-day periods, stat tiles, stacked SVG chart
  of daily active time (top 5 apps + other, hover tooltip, legend), sortable/searchable
  apps table with status and category filters, not-approved apps with alternatives,
  licensed-but-unused panel, category breakdown, CSV/JSON export, empty state, and a
  clearly marked demo-data mode.
- **Options**: Tracking, App lists (catalog search picker, alternatives, seats, custom
  apps), Reporting (status + send now), User notices (permission + live preview + test
  notification), Data (stats, export, clear), Branding, Backup & policy, About (with a
  hidden *Advanced (developer options)* → **Load demo data**).

## Try it

```bash
node tools/build.mjs --browsers chrome --only saas-reporter
# Load dist/chrome/saas-reporter as an unpacked extension.
node tools/dev-server.mjs --port 8787
```

1. Options → Reporting: endpoint `http://localhost:8787/api/saas/reports`, Save.
2. Browse a few apps (or Options → About → Advanced → Load demo data).
3. Click **Send report now**, then open <http://localhost:8787/> (or `/api/data`).

For local testing without internet, add a custom app for `localhost`
(`customApps: [{ "domain": "localhost", "name": "Local test", "category": "Other" }]`).

## Report payload

`POST reportEndpoint`, `Content-Type: application/json`, plus `reportHeaders`:

```json
{
  "source": "saas-reporter", "schema": 1,
  "installId": "6c1f…", "department": "Marketing", "extensionVersion": "1.0.0",
  "generatedAt": "2026-10-16T09:00:00.000Z",
  "period": { "from": "2026-09-17", "to": "2026-10-16" },
  "apps": [
    { "domain": "slack.com", "name": "Slack", "category": "Communication", "status": "sanctioned",
      "visits": 42, "activeMinutes": 610.5, "lastSeen": "2026-10-16" }
  ]
}
```

`installId` is a random ID generated per browser profile. `user: { email }` is added
only when `includeUserEmail` is true **and** `userEmail` is set. Domains outside the
catalog/classification (possible in `all-domains` scope) are included only with
`includeUnknownDomains`. The endpoint must accept CORS from the extension (the dev
server does) or the admin can grant the optional host permission.

## Settings

| Key | Type | Default | Description |
|---|---|---|---|
| `trackingEnabled` | boolean | `true` | Record usage. |
| `trackingScope` | `"catalog"` \| `"all-domains"` | `"catalog"` | What to record. |
| `ignoreDomains` | string[] | `[]` | Company/internal domains never recorded (`example.com`, `*.example.com`, `=host`). |
| `retentionDays` | integer | `90` | Days of local data kept. |
| `idleSeconds` | integer | `60` | Idle threshold (min 15). |
| `customApps` | `{domain,name,category,vendor?}[]` | `[]` | Extra apps; override the catalog for the same domain. |
| `sanctionedApps` | string[] | `[]` | Approved domains/patterns. |
| `unsanctionedApps` | string[] | `[]` | Discouraged/forbidden domains/patterns. |
| `alternatives` | object | `{}` | `{ "wetransfer.com": { "name": "OneDrive", "url": "https://…" } }`. |
| `licensedApps` | `{domain,name,seats?}[]` | `[]` | Paid apps; use the app's catalog domain. |
| `licenseUnusedDays` | integer | `30` | Unused-licence threshold. |
| `reportingEnabled` | boolean | `true` | Send reports (only when an endpoint is set). |
| `reportEndpoint` | string | `""` | Report URL. |
| `reportHeaders` | object | `{}` | Extra headers (secret: excluded from exports). |
| `reportIntervalHours` | integer | `24` | Hours between reports. |
| `reportPeriodDays` | integer | `30` | Rolling window per report. |
| `department` | string | `""` | Department tag. |
| `includeUnknownDomains` | boolean | `false` | Report uncatalogued domains. |
| `includeUserEmail` | boolean | `false` | Add `user.email`. |
| `userEmail` | string | `""` | Email used when the above is on. |
| `notifyOnUnsanctioned` | `"off"` \| `"notice"` | `"notice"` | Unapproved-app notice. |
| `noticeLearnMoreUrl` | string | `""` | "Why?" link (defaults to `brand.supportUrl`). |
| `brand` | object | build brand kit | Company branding. |

## Managed policy example

Keys inside `defaults` are suggestions; every other key is enforced and locked.

```json
{
  "reportEndpoint": "https://it.acme.example/api/saas/reports",
  "reportHeaders": { "Authorization": "Bearer REPLACE_ME" },
  "department": "Marketing",
  "ignoreDomains": ["acme.example", "acme.okta.com"],
  "sanctionedApps": ["slack.com", "google.com", "github.com", "figma.com", "atlassian.net", "zoom.us"],
  "unsanctionedApps": ["wetransfer.com", "chatgpt.com", "mail.google.com"],
  "alternatives": {
    "wetransfer.com": { "name": "OneDrive", "url": "https://acme-my.sharepoint.com" },
    "chatgpt.com": { "name": "Acme Copilot", "url": "https://copilot.acme.example" }
  },
  "licensedApps": [
    { "domain": "figma.com", "name": "Figma Organization", "seats": 25 },
    { "domain": "box.com", "name": "Box Enterprise", "seats": 120 }
  ],
  "defaults": { "trackingScope": "catalog", "retentionDays": 90 }
}
```

See `examples/policies/` for where to put this on Windows, macOS and Linux.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read the active tab's URL to know which app is in focus (only the hostname is used). |
| `webNavigation` | Count a visit when a top-frame navigation commits to an app. |
| `idle` | Stop counting active time when the user is away or the screen is locked. |
| `alarms` | 1-minute flush, report schedule with retry, daily pruning (survive service-worker shutdown). |
| `storage` | Settings, daily aggregates, session focus state, managed policy. |
| `notifications` | Unapproved-app notice when in-page notices are not allowed. |
| `scripting` | Inject the in-page notice into the one tab that opened an unapproved app. |
| `favicon` (Chrome/Edge) | App icons from the browser's favicon cache (no network requests). Removed for Firefox by the build. |
| optional `<all_urls>` | Only for the in-page notice (and, if needed, for reporting to an endpoint without CORS). |

**Notice design choice.** A branded in-page card is the better experience (it sits in
the app's own tab, carries the company logo and a direct "Open OneDrive" button), but
it needs host access to every site, which is a heavy permission for a tool whose
whole point is collecting less. So host access is **optional**: by default the notice
is a system notification (no site access at all), and an admin or user can opt into
in-page cards from Options → User notices. The script reads nothing from the page and
is injected only into the unapproved app's tab, at most once per app per day.
Organizations that force-install the extension and want in-page cards without a
prompt can move `<all_urls>` from `optional_host_permissions` to `host_permissions`.

Firefox: `data_collection_permissions.required = ["browsingActivity"]` (domains of
visited apps are transmitted when reporting is configured). If you enable
`includeUserEmail`, also declare `personallyIdentifyingInfo`.

## Privacy

- Stored: app domain, visits per day, active seconds per day, last day seen.
- Never stored or sent: full URLs, paths, query strings, page titles, page content,
  keystrokes, screenshots, private-window activity.
- Reports contain per-app totals, a random install ID and an optional department;
  identity only if IT enables `includeUserEmail`.
- Users can view everything on the dashboard, export it, and clear it.

## Development

- `logic.js` holds all pure logic (matching, aggregation, pruning, report payload,
  scheduling) and imports only `shared/domain.js` and `catalog.js`, so it runs in Node
  against the build output (`dist/chrome/saas-reporter/logic.js`).
- `background.js` is the service worker; `notice.js` is the injected notice;
  `common.js` holds page helpers; `saas.css` adds to the shared design system.

## Known limitations

- Active time is attributed to the tab in the last focused browser window; a video
  playing in a background window does not count, and an app left open while the
  user reads another window's content counts only until the idle threshold.
- `registrableDomain` uses a curated suffix list, not the full Public Suffix List.
- Custom apps or classifications for a more specific host than a catalog entry
  (e.g. licensing `acme.zendesk.com` while the catalog key is `zendesk.com`) should use
  the catalog key.
- Firefox does not support notification buttons; clicking the notification body opens
  the alternative.
- Reports are rolling-window totals (latest report per install supersedes earlier
  ones); servers that need history should store each report.
