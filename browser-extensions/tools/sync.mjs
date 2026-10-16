#!/usr/bin/env node
// Makes every extension folder loadable directly in the browser ("Load
// unpacked" on chrome://extensions or edge://extensions, or "Load Temporary
// Add-on" in Firefox), with no build step.
//
//   node tools/sync.mjs            refresh the copies in each extension folder
//   node tools/sync.mjs --check    exit 1 if any copy is out of date (used by check.mjs)
//
// For each extension it writes:
//   <ext>/shared/      copy of /shared (edit /shared, never the copies)
//   <ext>/shared/brand.json + brand logo, from brand/brand.json
//   <ext>/icons/       toolbar icons in the brand colours
// and adds to <ext>/manifest.json: icons, action.default_icon, and
// background.scripts next to background.service_worker, so the same folder
// runs in Chrome/Edge (service worker) and Firefox (background scripts).
//
// `node tools/build.mjs` still produces the per-browser store packages in dist/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIcon } from './icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = path.join(ROOT, 'shared');
const CHECK = process.argv.includes('--check');
const ICON_SIZES = [16, 32, 48, 128];
export const DIRECT_LOAD_MIN_CHROME = '121'; // first Chrome that accepts service_worker + scripts together

const brandFile = path.join(ROOT, 'brand', 'brand.json');
const brand = JSON.parse(fs.readFileSync(brandFile, 'utf8'));
brand.primary ||= '#4F46E5';
brand.accent ||= '#0EA5E9';

const extensions = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'manifest.json')))
  .map((d) => d.name);

// ---- desired file set per extension: Map<relativePath, Buffer> ----
function sharedFiles() {
  const out = new Map();
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'README.md' || e.name === 'brand.json') continue;
      const p = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r); else out.set(`shared/${r}`, fs.readFileSync(p));
    }
  })(SHARED, '');
  const baked = { ...brand };
  delete baked.extensionIdDomain;
  if (brand.logo && !/^(https?:|data:)/.test(brand.logo)) {
    const src = path.resolve(path.dirname(brandFile), brand.logo);
    const ext = path.extname(src).toLowerCase();
    out.set(`shared/brand-logo${ext}`, fs.readFileSync(src));
    baked.logo = `shared/brand-logo${ext}`;
  }
  out.set('shared/brand.json', Buffer.from(JSON.stringify(baked, null, 2) + '\n'));
  out.set('shared/GENERATED.md', Buffer.from(
    '# Generated copy\n\nThis folder is a copy of `browser-extensions/shared/`, written by\n' +
    '`node tools/sync.mjs` so this extension can be loaded unpacked without a build.\n' +
    'Edit the files in `browser-extensions/shared/` and re-run the sync; changes made here are overwritten.\n'));
  return out;
}

function syncManifest(manifest) {
  const m = structuredClone(manifest);
  m.icons = Object.fromEntries(ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`]));
  if (m.action) m.action.default_icon = Object.fromEntries([16, 32, 48].map((s) => [String(s), `icons/icon-${s}.png`]));
  if (m.background?.service_worker) {
    m.background.scripts = [m.background.service_worker];
    m.minimum_chrome_version = DIRECT_LOAD_MIN_CHROME;
  }
  return m;
}

const shared = sharedFiles();
let stale = [];
for (const ext of extensions) {
  const dir = path.join(ROOT, ext);
  const want = new Map(shared);
  for (const s of ICON_SIZES) want.set(`icons/icon-${s}.png`, renderIcon(ext, s, brand));

  const manifestPath = path.join(dir, 'manifest.json');
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const nextManifest = JSON.stringify(syncManifest(JSON.parse(manifestText)), null, 2) + '\n';
  want.set('manifest.json', Buffer.from(nextManifest));

  // files that should no longer exist in the generated folders
  const existing = [];
  for (const sub of ['shared', 'icons']) {
    (function walk(d, rel) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) walk(path.join(d, e.name), r); else existing.push(r);
      }
    })(path.join(dir, sub), sub);
  }

  for (const [rel, buf] of want) {
    const p = path.join(dir, rel);
    const cur = fs.existsSync(p) ? fs.readFileSync(p) : null;
    if (cur && cur.equals(buf)) continue;
    stale.push(`${ext}/${rel}`);
    if (!CHECK) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); }
  }
  for (const rel of existing) {
    if (want.has(rel)) continue;
    stale.push(`${ext}/${rel} (remove)`);
    if (!CHECK) fs.rmSync(path.join(dir, rel));
  }
}

if (CHECK) {
  if (stale.length) {
    console.error(`✖ ${stale.length} generated file(s) out of date. Run: node tools/sync.mjs\n  ${stale.slice(0, 10).join('\n  ')}${stale.length > 10 ? '\n  …' : ''}`);
    process.exit(1);
  }
  console.log('✔ sync: extension folders are up to date');
} else {
  console.log(stale.length ? `✔ synced ${extensions.length} extensions (${stale.length} file(s) updated)` : `✔ ${extensions.length} extensions already up to date`);
  console.log('  Load any folder directly: chrome://extensions → Load unpacked → browser-extensions/<extension>');
}
