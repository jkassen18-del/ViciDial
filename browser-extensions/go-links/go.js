// go.html: resolves a go-link as fast as possible and replaces the page with the target.
// Inputs:  go.html#payroll/extra?x=1   (literal http://go/… redirect, path style)
//          go.html?q=jira ABC-1          (omnibox / typed text)
//          go.html?s=payroll             (caught search-engine query, form-decoded)
// Only when the link does not exist is the full branded page loaded (notfound.js).

import { send } from './shared/messaging.js';

const params = new URLSearchParams(location.search);
const input = params.has('q') ? params.get('q') : params.has('s') ? params.get('s') : location.hash.slice(1);

async function resolveWithRetry() {
  try { return await send('resolve', { input }); } catch (err) {
    // the service worker may still be starting up
    await new Promise((r) => setTimeout(r, 250));
    return send('resolve', { input });
  }
}

async function main() {
  if (!input.trim()) { location.replace('directory.html'); return; }
  document.getElementById('boot-text').textContent = `Opening go/${input.split(/[/?#\s]/)[0]}…`;
  let res;
  try {
    res = await resolveWithRetry();
  } catch (err) {
    res = { found: false, error: String(err.message || err), key: input, suggestions: [] };
  }
  if (res.found) { location.replace(res.url); return; }
  if (res.empty) { location.replace('directory.html'); return; }
  const { showNotFound } = await import('./notfound.js');
  await showNotFound(res, input);
}

main();

// Editing the hash of an open go.html (e.g. go.html#payrol → #payroll) re-resolves.
window.addEventListener('hashchange', () => location.reload());
