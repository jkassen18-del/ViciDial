#!/usr/bin/env node
// Builds every extension for Chrome, Edge and Firefox from one source tree.
//
//   node tools/build.mjs [--brand brand/brand.json] [--browsers chrome,edge,firefox]
//                        [--only go-links,env-labeler] [--version 1.2.3] [--no-zip]
//
// Output:
//   dist/<browser>/<extension>/            unpacked, ready for "Load unpacked"
//   dist/<browser>/<extension>-<ver>.zip   store / policy upload package
//
// Each extension folder holds a Chrome-style MV3 manifest.json. It may carry a
// "browser_overrides": { "firefox": {...}, "chrome": {...}, "edge": {...} }
// object, deep-merged into the manifest for that browser and then removed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { renderIcon, crc32 } from './icons.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = path.join(ROOT, 'shared');
const DIST = path.join(ROOT, 'dist');
const BROWSERS = ['chrome', 'edge', 'firefox'];
const ICON_SIZES = [16, 32, 48, 128];
const FIREFOX_MIN = '128.0';

// ---------- args ----------
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const brandFile = path.resolve(ROOT, opt('brand', 'brand/brand.json'));
const browsers = opt('browsers', BROWSERS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const only = opt('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const versionOverride = opt('version', null);
const makeZip = !flag('no-zip');

for (const b of browsers) if (!BROWSERS.includes(b)) fail(`Unknown browser "${b}". Use: ${BROWSERS.join(', ')}`);

function fail(msg) { console.error(`\x1b[31m✖ ${msg}\x1b[0m`); process.exit(1); }
const log = (msg) => console.log(msg);

// ---------- helpers ----------
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === null) delete target[k];
    else if (isObj(v) && isObj(target[k])) deepMerge(target[k], v);
    else target[k] = structuredClone(v);
  }
  return target;
}

function copyDir(src, dest, skip = () => false, depth = 0) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || skip(entry.name, depth)) continue;
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d, skip, depth + 1);
    else fs.copyFileSync(s, d);
  }
}

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Minimal ZIP writer (deflate), so packaging works on any OS without `zip`. */
function writeZip(srcDir, zipPath) {
  const files = walk(srcDir);
  const local = [], central = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2024 - 1980) << 9 | 1 << 5 | 1; // fixed timestamp: reproducible builds
  for (const rel of files) {
    const data = fs.readFileSync(path.join(srcDir, rel));
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const useStore = comp.length >= data.length;
    const body = useStore ? data : comp;
    const name = Buffer.from(rel, 'utf8');
    const crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt16LE(useStore ? 0 : 8, 8); h.writeUInt16LE(dosTime, 10); h.writeUInt16LE(dosDate, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(useStore ? 0 : 8, 10); c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...local, cd, end]));
}

// ---------- brand ----------
if (!fs.existsSync(brandFile)) fail(`Brand file not found: ${brandFile}`);
let brand;
try { brand = JSON.parse(fs.readFileSync(brandFile, 'utf8')); } catch (e) { fail(`Brand file is not valid JSON: ${e.message}`); }
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
if (brand.primary && !HEX.test(brand.primary)) fail(`brand.primary must be a hex colour like #4F46E5`);
if (brand.accent && !HEX.test(brand.accent)) fail(`brand.accent must be a hex colour like #0EA5E9`);
brand.primary ||= '#4F46E5';
brand.accent ||= '#0EA5E9';

let logoSource = null;
if (brand.logo && !/^(https?:|data:)/.test(brand.logo)) {
  logoSource = path.resolve(path.dirname(brandFile), brand.logo);
  if (!fs.existsSync(logoSource)) fail(`Brand logo not found: ${logoSource}`);
}

// ---------- discover extensions ----------
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const extensions = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, d.name, 'manifest.json')))
  .map((d) => d.name)
  .filter((n) => !only.length || only.includes(n));
if (!extensions.length) fail('No extensions found to build.');

const idDomain = String(brand.extensionIdDomain || 'workplace-extensions.local').replace(/[^a-z0-9.-]/gi, '');

function buildManifest(ext, browser, src) {
  const m = structuredClone(src);
  const overrides = m.browser_overrides || {};
  delete m.browser_overrides;
  delete m.$comment;

  m.version = versionOverride || m.version || pkg.version;
  const baseName = m.name;
  const prefix = (brand.productPrefix || '').trim();
  m.name = prefix ? `${prefix} ${baseName}` : baseName;
  if (m.name.length > 75) m.name = m.name.slice(0, 75);
  m.short_name = (m.short_name || baseName).slice(0, 45);
  if (m.description) m.description = m.description.slice(0, 132);
  m.author = brand.companyName || m.author;

  const icons = Object.fromEntries(ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`]));
  m.icons = icons;
  if (m.action) m.action.default_icon = Object.fromEntries([16, 32, 48].map((s) => [String(s), `icons/icon-${s}.png`]));
  if (m.action && !m.action.default_title) m.action.default_title = m.name;

  if (browser === 'firefox') {
    if (m.background?.service_worker) {
      const sw = m.background.service_worker;
      m.background = { scripts: [sw], ...(m.background.type ? { type: m.background.type } : {}) };
    }
    delete m.minimum_chrome_version;
    if (m.storage) delete m.storage.managed_schema;
    if (m.storage && !Object.keys(m.storage).length) delete m.storage;
    m.permissions = (m.permissions || []).filter((p) => !['favicon', 'sidePanel'].includes(p));
    m.browser_specific_settings = deepMerge({
      gecko: {
        id: `${ext}@${idDomain}`,
        strict_min_version: FIREFOX_MIN,
        data_collection_permissions: { required: ['none'] },
      },
    }, m.browser_specific_settings || {});
  } else {
    delete m.browser_specific_settings;
    // Source manifests list background.scripts too (for direct loading in
    // Firefox, see tools/sync.mjs); store packages only need the service worker.
    if (m.background?.service_worker) delete m.background.scripts;
    if (m.minimum_chrome_version === '121') delete m.minimum_chrome_version;
    m.minimum_chrome_version ||= '116';
  }

  if (overrides[browser]) deepMerge(m, overrides[browser]);
  return m;
}

function checkReferences(dir, manifest) {
  const refs = [];
  const add = (p) => p && !/^https?:/.test(p) && refs.push(p.split(/[?#]/)[0]);
  add(manifest.background?.service_worker);
  (manifest.background?.scripts || []).forEach(add);
  add(manifest.action?.default_popup);
  add(manifest.options_ui?.page);
  add(manifest.options_page);
  add(manifest.storage?.managed_schema);
  for (const cs of manifest.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach(add);
  for (const r of manifest.declarative_net_request?.rule_resources || []) add(r.path);
  for (const p of Object.values(manifest.icons || {})) add(p);
  // HTML: local scripts and stylesheets
  for (const rel of walk(dir).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(dir, rel), 'utf8');
    for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) {
      if (/^(https?:|data:|#|mailto:)/.test(m[1])) continue;
      refs.push(path.posix.join(path.posix.dirname(rel), m[1]).split(/[?#]/)[0]);
    }
  }
  // JS: static relative imports
  for (const rel of walk(dir).filter((f) => f.endsWith('.js'))) {
    const js = fs.readFileSync(path.join(dir, rel), 'utf8');
    for (const m of js.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      refs.push(path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1] || m[2])));
    }
  }
  const missing = [...new Set(refs)].filter((r) => !fs.existsSync(path.join(dir, r)));
  if (missing.length) fail(`${path.relative(ROOT, dir)}: missing files referenced:\n  ${missing.join('\n  ')}`);
}

// ---------- build ----------
fs.mkdirSync(DIST, { recursive: true });
const started = Date.now();
log(`\nBuilding ${extensions.length} extension(s) for ${browsers.join(', ')}  ·  brand: ${brand.companyName || '(unnamed)'} (${path.relative(ROOT, brandFile)})\n`);

const iconCache = new Map();
for (const browser of browsers) {
  for (const ext of extensions) {
    const srcDir = path.join(ROOT, ext);
    const outDir = path.join(DIST, browser, ext);
    fs.rmSync(outDir, { recursive: true, force: true });

    // shared/ and icons/ inside the extension folder are sync.mjs copies; the
    // build writes fresh ones below using the selected brand kit.
    copyDir(srcDir, outDir, (name, depth) => depth === 0 && ['manifest.json', 'README.md', 'node_modules', 'shared', 'icons'].includes(name));
    copyDir(SHARED, path.join(outDir, 'shared'), (name) => name === 'README.md');

    // brand
    const bakedBrand = { ...brand };
    delete bakedBrand.extensionIdDomain;
    if (logoSource) {
      const extName = path.extname(logoSource).toLowerCase();
      fs.copyFileSync(logoSource, path.join(outDir, 'shared', `brand-logo${extName}`));
      bakedBrand.logo = `shared/brand-logo${extName}`;
    }
    fs.writeFileSync(path.join(outDir, 'shared', 'brand.json'), JSON.stringify(bakedBrand, null, 2));

    // icons
    fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });
    for (const size of ICON_SIZES) {
      const key = `${ext}:${size}`;
      if (!iconCache.has(key)) iconCache.set(key, renderIcon(ext, size, brand));
      fs.writeFileSync(path.join(outDir, 'icons', `icon-${size}.png`), iconCache.get(key));
    }

    // manifest
    const src = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
    const manifest = buildManifest(ext, browser, src);
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    checkReferences(outDir, manifest);

    let zipNote = '';
    if (makeZip) {
      const zipPath = path.join(DIST, browser, `${ext}-${manifest.version}.zip`);
      writeZip(outDir, zipPath);
      zipNote = `  →  ${path.relative(ROOT, zipPath)} (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KB)`;
    }
    log(`  \x1b[32m✔\x1b[0m ${browser.padEnd(8)} ${manifest.name.padEnd(36)} v${manifest.version}${zipNote}`);
  }
}
log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s. Unpacked builds are in dist/<browser>/<extension>/\n`);
