# Data Leak Guard

"DLP lite" for the browser. Data Leak Guard checks what people **paste, drop, upload or send** into websites. It looks for payment cards, national ID numbers, secrets, documents marked confidential and your own patterns. Then it **logs, warns or blocks** according to company policy, before the data reaches public AI chatbots, personal e-mail, file sharing or any other unapproved destination.

All scanning happens locally in the page. **The sensitive content is never stored and never transmitted.** Only rule names, counts, the hostname, the channel and the user's decision are recorded.

## Features

- **Detectors with strong validation**, to keep false alarms low:
  - Payment cards: 13–19 digits with optional spaces or dashes, **Luhn** check, known IIN ranges (Visa, Mastercard incl. 2-series, Amex, Discover, JCB, Diners, UnionPay). Repeated or sequential digits, mixed separators and odd groupings are rejected.
  - US SSN: area/group/serial rules (no 000, 666 or 9xx; no group 00; no serial 0000) plus known advertising numbers. Accepts formatted numbers, or a bare 9 digits right after an "SSN" label.
  - UK National Insurance number: valid prefix letters, reserved prefixes excluded.
  - Canadian SIN: written as 3-3-3 groups, Luhn check.
  - IBAN: per-country length table plus **mod-97**.
  - Australian TFN: weighted checksum. Off by default.
  - Secrets: PEM/OpenSSH/PGP private keys, AWS key IDs (AKIA/ASIA…), GitHub (ghp_/gho_/ghu_/ghs_/ghr_/github_pat_), Slack (xox[baprs]-), Google API keys (AIza…), Stripe live keys (sk_live_/rk_live_), and JWTs (the header must decode to JSON with `alg`). Also `password=` / `api_key:` assignments, at a lower default severity (log), with placeholders ignored.
  - Classification markers: configurable keywords, matched as whole words and case-insensitive. Defaults are CONFIDENTIAL, STRICTLY CONFIDENTIAL, INTERNAL ONLY, RESTRICTED and DO NOT DISTRIBUTE.
  - Bulk e-mail: at least N distinct addresses at once (default 10).
  - **Custom rules**: admin-defined regex with flags, minimum count and action. The regex is validated and can be tested live.
- **Masked samples only**, for example `•••• •••• •••• 4242`, `AKIA••••••••MPLE` or `•••-••-6789`.
- **Fast scanning**: text is capped at 2 MB, and each rule stops after 500 matches. A 2 MB scan takes about 45 ms in Node.
- **Per-rule actions**: off, log, warn or block. "Default" uses the global default action.
- **High-risk escalation**: about 50 curated public AI, webmail, file-sharing, paste and messaging sites are included. On these sites, warn-level rules can become **block**.
- **Two scope modes**:
  - `all-except-trusted` (the default) protects every site except your trusted company domains.
  - `listed` protects only the high-risk list.
- **Channels**, each one toggleable:
  - Paste.
  - Drag and drop of text and files.
  - File uploads: file **names** are always checked, and the **contents** of text-like files (txt, csv, json, md, log, xml, html, yaml, env, pem, key, sql, source code…) up to 5 MB.
  - Typed messages when the user presses Enter or submits a form. This applies on high-risk sites only and is off by default.
- An optional policy can **warn on, or block, every file upload to high-risk sites**, whatever the content.
- **Branded in-page modal** in a closed shadow DOM. It shows a title (for example "Card number detected"), an explanation, the rule names with masked samples, and the destination.
  - Warn shows **Cancel** (focused by default) and **Continue anyway**. It can optionally **require a typed reason**.
  - Block shows only **OK**, plus a link to company support.
- **Continue re-inserts the original content**:
  - Pastes are replayed as a synthetic `paste` with a fresh `DataTransfer`. If the page ignores it, the extension falls back to `execCommand('insertText')`. This works for inputs, textareas and ProseMirror-style editors.
  - Drops are replayed as a synthetic `drop` with the same files.
  - For file inputs, the `input` and `change` events are re-dispatched. If the user cancels, the input is cleared.
- **Incident log** with the last 500 incidents, CSV export and filters. A **toolbar badge** shows today's warnings and blocks. It is red if anything was blocked and amber otherwise.
- **Optional reporting** to your SIEM or webhook. Incidents are sent in batches, with retry and exponential back-off through `alarms`, and can include custom headers, a department and (optionally) the user's e-mail.
- **Popup**:
  - Status of the current site: Protected, High-risk destination, or Trusted site — not scanned.
  - Channel chips and today's statistics.
  - Recent alerts.
  - A **"Test detection" box**. Text typed there never leaves the browser.
- **Options page**:
  - Protection, Detectors table, Custom rules editor and Sites list editors (with a URL checker).
  - Reporting (with "Send test event"), **Test lab** (highlighted matches, normal or high-risk simulation, includes unsaved edits) and Incident log.
  - Branding, Backup & policy, and About.
- Optional **user disable** and **snooze**. Both are off by default.

## Try it

```bash
node tools/build.mjs --browsers chrome,edge,firefox --only dlp-guard
# Chrome/Edge: load dist/chrome/dlp-guard unpacked. Firefox: about:debugging → load dist/firefox/dlp-guard/manifest.json
```

1. Open any website with a text box, for example a page you serve from `http://localhost`.
2. Paste `4111 1111 1111 1111`. A warning appears. **Cancel** keeps the text out, and **Continue anyway** pastes it.
3. Paste `AKIAIOSFODNN7EXAMPLE`. This is blocked by default.
4. Upload a `.env` or `.csv` file that contains a key or card number.
5. Open the options page → **Test lab** → **Insert sample data** to see every detector at work.

Reporting with the bundled dev server:

```bash
node tools/dev-server.mjs   # http://localhost:8787
```

Set **Reporting → endpoint** to `http://localhost:8787/api/dlp/incidents`, then click **Send test event**. Incidents appear on the dashboard at `http://localhost:8787/`.

## Settings reference

| Key | Type | Default | Description |
|---|---|---|---|
| `mode` | `"all-except-trusted"` \| `"listed"` | `all-except-trusted` | Protect everywhere except trusted sites, or only listed high-risk sites. |
| `trustedSites` | string[] | `[]` | Company / approved destinations, never scanned. Add your own, e.g. `acme.com`, `acme.sharepoint.com`, `=docs.google.com/a/acme.com*`. Trusted wins over high-risk. |
| `highRiskSites` | string[] | curated list (~50) | Public AI, personal webmail, file sharing, paste sites, messaging, online converters. |
| `defaultAction` | `log` \| `warn` \| `block` | `warn` | Used by custom rules and by rules set to `default`. |
| `ruleActions` | object | see below | Action per built-in rule id: `off` / `log` / `warn` / `block` / `default`. |
| `highRiskAction` | `same` \| `warn` \| `block` | `block` | On high-risk sites, rules at warn level are escalated to this action. Log-only rules stay silent. |
| `requireJustification` | boolean | `false` | Require a typed reason before "Continue anyway". |
| `blockFileUploadsOnHighRisk` | `off` \| `warn` \| `block` | `off` | Warn on, or block, every file upload to high-risk sites. |
| `channels` | `{ paste, drop, upload, submit }` | `true, true, true, false` | Channels that are inspected. `submit` only ever applies on high-risk sites. |
| `maxFileSizeMB` | number | `5` | Text-like files are scanned up to this size. |
| `classificationKeywords` | string[] | 5 markers | Classification keywords. |
| `bulkEmailThreshold` | integer | `10` | Number of distinct e-mail addresses that triggers the bulk e-mail rule. |
| `customRules` | object[] | `[]` | `{ id, name, description?, pattern, flags, minCount, action, enabled }` |
| `allowUserDisable` | boolean | `false` | Show an on/off switch in the popup. Uses the `enabled` setting. |
| `allowSnooze` | boolean | `false` | Offer "Pause N min on this site" (warnings only, never blocks). |
| `snoozeMinutes` | integer | `15` | Length of a snooze. |
| `reportingEndpoint` | string | `""` | POST target for incident batches. Empty means everything stays on the device. |
| `reportingHeaders` | object | `{}` | Extra headers, e.g. `Authorization`. Excluded from settings export. |
| `department` | string | `""` | Sent with reports. |
| `includeUserEmail` / `userEmail` | boolean / string | `false` / `""` | Add the user's e-mail to reports. |
| `brand` | object | build brand kit | Standard brand overrides. |

Rule ids and default actions:

| Rule id | Default action |
|---|---|
| `card` | warn |
| `iban` | warn |
| `us-ssn` | warn |
| `uk-nino` | warn |
| `ca-sin` | warn |
| `au-tfn` | off |
| `private-key` | block |
| `aws-key` | block |
| `github-token` | block |
| `slack-token` | block |
| `google-api-key` | block |
| `stripe-key` | block |
| `jwt` | warn |
| `password-assignment` | log |
| `classification` | warn |
| `bulk-email` | warn |

Site patterns use `shared/domain.js` syntax:

| Pattern | Matches |
|---|---|
| `example.com` | The domain and its subdomains |
| `=host` | That exact host only |
| `*.example.com` | Subdomains only |
| `host/path*` | The host plus a path glob |
| `re:<regex>` | The regex, tested against the full URL |

## Managed policy example

Chrome / Edge (`3rdparty.extensions.<id>`) or Firefox (`policies.3rdparty.Extensions.<id>`):

```json
{
  "mode": "all-except-trusted",
  "trustedSites": ["acme.com", "acme.sharepoint.com", "acme.atlassian.net"],
  "highRiskAction": "block",
  "requireJustification": true,
  "blockFileUploadsOnHighRisk": "warn",
  "ruleActions": { "card": "block", "jwt": "block", "au-tfn": "warn" },
  "customRules": [
    { "id": "employee-id", "name": "Employee ID", "pattern": "\\bEMP-\\d{6}\\b", "flags": "", "minCount": 3, "action": "warn" },
    { "id": "falcon", "name": "Project Falcon", "pattern": "project\\s+falcon", "flags": "i", "minCount": 1, "action": "block" }
  ],
  "reportingEndpoint": "https://siem.acme.example/api/dlp/incidents",
  "reportingHeaders": { "Authorization": "Bearer REPLACE_ME" },
  "department": "Finance",
  "defaults": { "channels": { "paste": true, "drop": true, "upload": true, "submit": true } }
}
```

Keys inside `defaults` are suggestions that users can change. All other keys are enforced, and the options page shows them as locked. A policy can lock a single rule, for example `ruleActions.card`. Use **Backup & policy → Generate policy** to turn the current configuration into a policy file.

## Reporting payload

```json
{
  "source": "dlp-guard",
  "installId": "6a1f…",
  "extensionVersion": "1.0.0",
  "department": "Finance",
  "userEmail": "only when includeUserEmail is on",
  "events": [{
    "id": "uuid", "timestamp": "2026-10-16T09:12:00.000Z", "domain": "chatgpt.com",
    "channel": "paste", "detections": [{ "ruleId": "card", "ruleName": "Payment card number", "count": 1 }],
    "action": "warn", "decision": "cancelled", "justification": "", "highRisk": true
  }]
}
```

- `channel` is one of `paste`, `drop`, `upload` or `submit`.
- `decision` is one of `cancelled`, `proceeded`, `blocked` or `logged`.
- Batches hold up to 100 events.
- If delivery fails, the queue (max 1000 events) is retried with back-off of 1, 2, 4 … up to 60 minutes. The retry is checked by a 1-minute alarm.

## Permissions

| Permission | Why |
|---|---|
| Content script on `<all_urls>`, all frames, `match_about_blank` | Inspect paste, drop, upload and submit events on every site, including editors in iframes. |
| `storage` | Settings, incident log, report queue, snoozes. |
| `alarms` | Retry reporting and refresh the daily badge (survives service-worker shutdown). |
| `activeTab` | The popup shows the status of the current tab. |
| optional host permissions (`http(s)://*/*`) | Requested only for the reporting endpoint when an admin clicks "Send test event" or "Send queued now". |
| Managed storage schema (`schema.json`) | Enterprise policy. |

Firefox: `data_collection_permissions` is `required: ["none"]`, with `optional: ["websiteActivity", "personallyIdentifyingInfo"]`. Nothing is sent unless an admin configures reporting. The optional user e-mail is the only personal identifier.

## Privacy

- Content is scanned in memory inside the page and is never written to storage or sent anywhere.
- Modals show only masked samples.
- The incident log and reports contain only the following: rule id and name, count, the hostname (never the full URL or path), the channel, the action, the user's decision, the user-typed justification, and whether the site is high-risk.
- The "approved" memory used to avoid asking twice on the same page stores only 32-bit FNV hashes of values, in memory, for that page only.

## Known limitations

- **Typed text** is checked only on Enter or form submit on high-risk sites. This is off by default. Clicking a custom "send" button that is not part of a form is not intercepted.
- Some sites check `event.isTrusted` or read the clipboard themselves. On those sites a replayed paste or drop may be ignored. Pastes then fall back to `execCommand('insertText')`, but a replayed drop onto a custom drop zone may need to be repeated by hand.
- Binary documents (PDF, Office files, images, archives) are checked **by file name only**. Only text-like files are content-scanned, up to `maxFileSizeMB`.
- During the short asynchronous scan of a selected file, the page cannot see the `input`/`change` events. However, `input.files` is already populated, so a native form submitted in that window could still include the file.
- In small iframes, the modal renders inside the frame.
- If the extension is updated or reloaded, tabs that are already open fail open until they are reloaded.
- Not covered:
  - Uploads made with `showOpenFilePicker` or other File System Access APIs.
  - Programmatic clipboard reads by the page.
  - Screenshots.
  - Non-browser channels.
- In Firefox, events created by the content script follow Xray rules. The insert fallback covers inputs and contenteditable fields, but rich editors that only accept their own paste handling may need the text pasted again.
- National ID coverage is limited to US, UK, CA, AU and IBAN. Add other formats as custom rules.
