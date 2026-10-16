# Deploying with policy

Each extension reads managed settings from the browser's enterprise policy
(`storage.managed`). There are two kinds of keys:

* **`defaults`**: suggested values. Users see them preselected and can change them.
* **Every other key** is enforced. The options page shows it as *Managed* and the user can't edit it.

The **Generate policy** button under *Options → Backup & policy* turns the current
configuration into ready-to-paste JSON with the right extension ID. Configure
one browser by hand, generate the policy, and roll it out everywhere.

Replace `EXTENSION_ID` below with the real ID: the Chrome Web Store / Edge
Add-ons ID for published extensions, or the `<ext>@<extensionIdDomain>` gecko
ID for Firefox (set `extensionIdDomain` in `brand/brand.json`; the default build
uses `@acme.example`).

| File | Browser / OS |
|---|---|
| `chrome-linux-managed.json` | Chrome on Linux: copy to `/etc/opt/chrome/policies/managed/` (Chromium: `/etc/chromium/policies/managed/`, Edge: `/etc/opt/edge/policies/managed/`) |
| `chrome-windows.reg` | Chrome on Windows (import, or translate into Group Policy / Intune) |
| `edge-windows.reg` | Microsoft Edge on Windows |
| `chrome-macos.md` | Chrome / Edge on macOS (configuration profile) |
| `firefox-policies.json` | Firefox on any OS: `policies.json` in the `distribution/` folder of the install, or the equivalent GPO / Intune / macOS profile |

## Force-installing the extensions

* **Chrome / Edge**: publish to the Chrome Web Store or Edge Add-ons (unlisted
  or private to your domain), then add `EXTENSION_ID;https://clients2.google.com/service/update2/crx`
  (Edge: `EXTENSION_ID;https://edge.microsoft.com/extensionwebstorebase/v1/crx`) to
  `ExtensionInstallForcelist`. Self-hosting a `.crx` with an update manifest also works.
* **Firefox**: sign the zip with Mozilla (`npx web-ext sign --channel unlisted`;
  release Firefox only installs signed add-ons), host the `.xpi`, and use
  `ExtensionSettings` with `installation_mode: "force_installed"` and `install_url`.
