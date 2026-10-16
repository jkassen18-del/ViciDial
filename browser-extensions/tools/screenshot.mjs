#!/usr/bin/env node
// Loads a built extension into headless Chromium and screenshots one of its pages.
// Useful for checking UI changes without a desktop browser.
//
//   node tools/screenshot.mjs --ext go-links --page options.html --out shot.png
//        [--width 1280] [--height 900] [--theme dark|light] [--full]
//        [--url https://example.com]     open a web page instead (content scripts run)
//        [--eval "js to run in the page before the shot"] [--wait 600]
//
// Requires `npm run build` (or node tools/build.mjs --browsers chrome) first and
// the `playwright` package (globally installed is fine).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const flag = (n) => args.includes(`--${n}`);

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  const globalRoot = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules');
  const require = createRequire(path.join(globalRoot, 'noop.js'));
  return require('playwright');
}

const ext = opt('ext');
if (!ext) { console.error('--ext is required'); process.exit(1); }
const extDir = path.join(ROOT, 'dist', 'chrome', ext);
if (!fs.existsSync(extDir)) { console.error(`Not built: ${extDir}. Run: node tools/build.mjs --browsers chrome`); process.exit(1); }

const { chromium } = await loadPlaywright();
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-shot-'));
const context = await chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: Number(opt('width', 1280)), height: Number(opt('height', 900)) },
  colorScheme: opt('theme', 'light'),
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
try {
  let [sw] = context.serviceWorkers();
  sw ||= await context.waitForEvent('serviceworker', { timeout: 10000 });
  const id = new URL(sw.url()).host;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const target = opt('url') || `chrome-extension://${id}/${opt('page', 'popup.html')}`;
  await page.goto(target, { waitUntil: 'load' });
  if (opt('eval')) await page.evaluate(opt('eval'));
  await page.waitForTimeout(Number(opt('wait', 600)));
  const out = path.resolve(opt('out', `${ext}.png`));
  await page.screenshot({ path: out, fullPage: flag('full') });
  console.log(`saved ${out}  (extension id ${id})`);
  if (errors.length) { console.log('page errors:'); for (const e of errors) console.log('  ' + e); }
} finally {
  await context.close();
  fs.rmSync(userDir, { recursive: true, force: true });
}
