#!/usr/bin/env node
// Fast sanity checks: every JS file parses, every JSON file is valid, and a
// full build (which verifies manifest/HTML/import references) succeeds.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['dist', 'node_modules', '.dev-server-data']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
})(ROOT);

let failed = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f);
  if (/\.(m?js)$/.test(f)) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) { failed++; console.error(`✖ ${rel}\n${r.stderr}`); }
  } else if (f.endsWith('.json')) {
    try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { failed++; console.error(`✖ ${rel}: ${e.message}`); }
  }
}
console.log(`${failed ? '✖' : '✔'} syntax: ${files.filter((f) => /\.(m?js|json)$/.test(f)).length} files checked, ${failed} problem(s)`);
if (failed) process.exit(1);

const b = spawnSync(process.execPath, [path.join(ROOT, 'tools/build.mjs'), '--no-zip'], { stdio: 'inherit' });
process.exit(b.status ?? 1);
