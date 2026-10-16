# Ticket Snap

Report a problem to IT in a few seconds. Ticket Snap screenshots the current tab, lets you annotate and **redact** it, attaches browser diagnostics, and submits a pre-filled ticket to your helpdesk (webhook, Jira Service Management, Zendesk, Freshdesk, ServiceNow or email).

## Features

- **Three ways to capture**: the toolbar popup (big "Capture this tab" button), the keyboard shortcut **Alt+Shift+S**, or right-click → **Report a problem with this page**. Each one can also report without a screenshot.
- **Annotator** (`annotate.html`), a full-page editor:
  - Tools: select/move (V), pen (P), highlighter (H), arrow (A), rectangle (R), ellipse (E), text (T), **redact** (B) and crop (C). Hold Shift to snap arrows to 45° or draw squares and circles.
  - Colour palette (brand primary, red, amber, green, blue, black, white) and three stroke widths (1/2/3).
  - Undo and redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y), clear all, and Delete for the selected item. Double-click a text label to edit it.
  - Annotations are vector objects in image coordinates and are rendered onto the image at full resolution on export. HiDPI is handled. Redaction boxes are opaque, integer-aligned black fills, so the pixels under them are gone from the exported PNG.
  - When a page can't be captured (browser pages, extension stores), you can paste (Ctrl+V) or drop an image instead.
- **Ticket form**: summary (required), description with a template hint, category, priority (Low/Normal/High/Urgent), reporter name and email pre-filled from settings, "Include screenshot" and "Include page address" options, and a collapsible **Diagnostics** block that shows exactly what will be sent.
- **Diagnostics**: page URL, title, browser and version, OS and version, architecture, language, time zone, screen and pixel ratio, viewport, zoom, timestamp, extension version and user agent (user agent is off by default). Admins can switch off any item.
- **Submit flow**: the button shows each step ("Uploading screenshot…", "Creating request…"), then a success view with the ticket ID, a link and a copy button. On an error you get a readable message, **Try again**, and a **Download screenshot + copy details** fallback. **Download PNG** and **Copy details** are always available.
- **History**: the last 50 submissions (summary, time, helpdesk, ID, link) are stored locally and shown in the popup and on the options page.
- Branding, managed policy with locks, settings export and import (secrets are stripped), and light and dark themes all use the shared layer.

## Try it

```bash
node tools/build.mjs --browsers chrome,edge,firefox --only ticket-snap
node tools/dev-server.mjs --port 8787          # local helpdesk for the Webhook provider
```

1. Load `dist/chrome/ticket-snap` with **Load unpacked**, or `dist/firefox/ticket-snap/manifest.json` through `about:debugging`.
2. Open the settings. **Webhook** is selected. Set the URL to `http://localhost:8787/api/tickets` and click **Test connection**; allow access when the browser asks.
3. Open any web page, click the toolbar icon and choose **Capture this tab**. Annotate the screenshot, fill in the summary and press **Submit ticket**.
4. Open http://localhost:8787. The ticket is listed there with the annotated screenshot.

Provider unit tests run against the build output, with `fetch` stubbed:

```bash
node tools/build.mjs --browsers chrome --only ticket-snap
node --test ticket-snap/.tests/providers.test.mjs
```

## Providers

Each provider is a module in `providers/` exporting `{ id, label, fields, endpoint(settings), submit({ ticket, context, screenshotBlob, settings, onProgress }) → { id, url, warnings? }, test(settings) }`. The options page renders the configuration form from `fields`.

| Provider | What it does | Priority mapping |
|---|---|---|
| `webhook` (default) | `POST` JSON to `webhookUrl` with optional `webhookHeaders`. Payload: `{ source: "ticket-snap", version, ticket: { summary, description, category, priority, reporter: { name, email } }, context: { url, title, browser, os, …diagnostics }, text, screenshot: { filename, mime: "image/png", dataBase64 } \| null }`. A `{ id, url }` JSON response is shown to the user. | `low` / `normal` / `high` / `urgent` |
| `jsm` | `attachTemporaryFile` (multipart, `X-ExperimentalApi: opt-in`, `X-Atlassian-Token: no-check`), then `POST /rest/servicedeskapi/request`, then `POST /request/{key}/attachment`. Uses Basic auth with email and API token. The link opens the customer portal, or `/browse/KEY` when set to agent view. | Optional `priority` field: Low / Medium / High / Highest |
| `zendesk` | `POST /api/v2/uploads?filename=…` (binary body) to get an upload token, then `POST /api/v2/requests` or `/api/v2/tickets` (set by `zendeskEndpoint`). Auth is `email/token:TOKEN`. | `low` / `normal` / `high` / `urgent` |
| `freshdesk` | One multipart `POST /api/v2/tickets` with `email`, `subject`, an HTML `description`, `priority`, `status: 2` and `attachments[]`. Auth is `key:X`. | 1 / 2 / 3 / 4 |
| `servicenow` | `POST /api/now/table/incident`, then `POST /api/now/attachment/file?table_name=incident&table_sys_id=…`. Uses Basic auth or a bearer token. The link is `nav_to.do?uri=incident.do?sys_id=…`. | Urgency/impact: Urgent 1/1, High 1/2, Normal 2/2, Low 3/2 |
| `email` | Opens a `mailto:` addressed to `emailTo` (or `brand.supportEmail` if that is empty), with the subject and body (diagnostics included) filled in. It also downloads the annotated PNG so the user can attach it, because `mailto:` cannot carry attachments. | written into the body |

Errors are rewritten into readable messages. For example, a 401 becomes "rejected the credentials, check the API token…", a 404 becomes "check the URL / desk ID", 413 and 429 have their own messages, and a network failure becomes "Can't reach host…". If a screenshot fails to attach after the ticket was created, the user sees a warning instead of an error.

## Settings reference

| Key | Default | Description |
|---|---|---|
| `provider` | `webhook` | `webhook`, `jsm`, `zendesk`, `freshdesk`, `servicenow` or `email` |
| `webhookUrl` / `webhookHeaders` | `""` / `{}` | Webhook endpoint and extra headers (secret) |
| `jsmBaseUrl`, `jsmEmail`, `jsmApiToken`, `jsmServiceDeskId`, `jsmRequestTypeId` | `""` | Jira Service Management connection (the token is secret) |
| `jsmRaiseOnBehalf`, `jsmSetPriority`, `jsmLinkTarget` | `false`, `false`, `portal` | JSM options |
| `zendeskSubdomain`, `zendeskEmail`, `zendeskApiToken`, `zendeskEndpoint` | `""`, `""`, `""`, `requests` | Zendesk connection (the token is secret) |
| `freshdeskDomain`, `freshdeskApiKey` | `""` | Freshdesk connection (the key is secret) |
| `servicenowInstance`, `servicenowAuth`, `servicenowUsername`, `servicenowPassword`, `servicenowToken` | `""`, `basic`, … | ServiceNow connection (the password and token are secret) |
| `servicenowSetCaller`, `servicenowAssignmentGroup` | `true`, `""` | Set `caller_id` from the reporter email; optional assignment group |
| `emailTo` | `""` | Email provider address (falls back to `brand.supportEmail`) |
| `categories` | Hardware, Software, Access & accounts, Network, Other | Category list (an empty list hides the field) |
| `defaultCategory` / `defaultPriority` | `Software` / `normal` | Form defaults |
| `requiredFields` | `[]` | Any of `description`, `category`, `reporterName`, `reporterEmail` (summary is always required) |
| `summaryPrefix` | `""` | Prepended to every summary |
| `descriptionTemplate` / `descriptionPrefill` | template / `false` | Hint text, optionally pre-filled into the description |
| `reporterName` / `reporterEmail` | `""` | Pre-filled reporter |
| `includeScreenshotDefault` | `true` | Whether "Include screenshot" starts ticked |
| `diagnostics.{url,title,browser,os,arch,language,timeZone,screen,viewport,zoom,capturedAt,extensionVersion,userAgent}` | all `true` except `userAgent` | Which diagnostics are collected |
| `allowRemoveUrl` | `true` | Lets users untick "Include page address" |
| `showContextMenu` | `true` | Shows the right-click menu item |
| `keepHistory` | `true` | Keeps the local history of submissions |
| `brand` | brand kit | Shared branding (see the shared README) |

## Managed policy example

These keys go in the extension's managed storage (Chrome/Edge `3rdparty.extensions.<id>`, Firefox `3rdparty.Extensions.<id>`). Keys inside `defaults` are suggestions that users can change; every other key is enforced and locked in the UI.

```json
{
  "provider": "jsm",
  "jsmBaseUrl": "https://acme.atlassian.net",
  "jsmEmail": "helpdesk-bot@acme.com",
  "jsmApiToken": "ATATT3x…",
  "jsmServiceDeskId": "4",
  "jsmRequestTypeId": "17",
  "jsmRaiseOnBehalf": true,
  "diagnostics": { "userAgent": false },
  "allowRemoveUrl": true,
  "categories": ["Hardware", "Software", "Access & accounts", "Network", "Printers", "Other"],
  "requiredFields": ["reporterEmail"],
  "defaults": { "defaultPriority": "normal", "includeScreenshotDefault": true },
  "brand": { "companyName": "Acme Inc.", "supportEmail": "it-help@acme.example" }
}
```

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Lets the extension call `tabs.captureVisibleTab` and read the URL and title of the tab you invoked it on (from the popup, the shortcut or the context menu). It gives no access to other tabs. |
| `storage` | Settings, ticket history, and the short-lived hand-off of the capture to the annotator (`storage.session`, falling back to `storage.local` with automatic cleanup). |
| `contextMenus` | The "Report a problem with this page" menu item. |
| `optional_host_permissions` `https://*/*`, `http://*/*` | Only requested at runtime, for the **one** helpdesk origin you configure. The request happens when you press Submit or Test connection, so the extension can call the helpdesk API without CORS limits. |
| `commands` (manifest key) | The Alt+Shift+S shortcut. |

There are no content scripts, and the extension has no host access until you grant it for your helpdesk.

## Privacy

- Nothing is captured in the background. A screenshot is taken only when you ask for one. It stays in `storage.session`, which is memory-only and cleared when the browser closes, until you submit or close it. Captures older than 6 hours are pruned.
- Data goes **only** to the helpdesk configured in settings. No other server is involved, and there is no analytics.
- You see every diagnostic item before it is sent. Admins can disable items entirely, and users can remove the page URL.
- Redaction boxes are drawn into the exported pixels and cannot be removed by the recipient.
- API tokens and passwords are stored in this browser's extension storage and are never included in settings exports.
- Firefox `data_collection_permissions`: `websiteContent` (screenshot), `browsingActivity` (page URL), `personallyIdentifyingInfo` (reporter name and email). All of it is sent only when the user submits.

## Known limitations

- `captureVisibleTab` captures the **visible** viewport only. There is no full-page scrolling capture.
- Browser-internal pages, extension stores and other extensions' pages can't be captured. Users can still report, and can paste a screenshot.
- `mailto:` cannot attach files, so the Email provider downloads the PNG for the user to attach. Very long bodies are shortened to stay under the length limits of mail clients. **Copy details** has the full text.
- Most helpdesk APIs expect a service account. Credentials stored in the extension are readable by anyone with access to the browser profile. For larger rollouts, prefer the Webhook provider pointing at a small server-side relay that holds the real credentials.
- Jira Service Management's `attachTemporaryFile` is an experimental API. If it fails, the request is still created and the user is warned.
- ServiceNow `caller_id` is sent as the reporter email; instances that do not resolve users by email ignore it.
