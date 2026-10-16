// Data Leak Guard content script (classic script, all frames, document_start).
// Loaded after shared/content-ui.js (WX) and detectors.js (DLPDetectors).
//
// Every listener is registered synchronously in the capture phase on `window`
// before the policy arrives. When something sensitive is found, the original
// event is stopped, a branded modal explains why, and — if the user is allowed
// to continue — the content is replayed into the page.
//
// Nothing scanned here ever leaves the page: the background only receives rule
// names, counts, the hostname, the channel and the user's decision.
(() => {
  if (globalThis.__dlpGuardLoaded) return;
  globalThis.__dlpGuardLoaded = true;
  const D = globalThis.DLPDetectors;
  const WX = globalThis.WX;
  if (!D || !WX) return;
  const RANK = D.RANK;

  let policy = null;
  let policyPromise = null;
  let busy = false;
  let replaying = false;
  const approved = new Set(); // fingerprints of values the user chose to share on this page
  const fileInputs = new WeakMap(); // <input type=file> -> { sig, state }

  // -------------------------------------------------------------------------
  // Policy
  // -------------------------------------------------------------------------
  function pageUrl() {
    const href = location.href;
    if (/^(https?|file):/i.test(href)) return href;
    try { const a = location.ancestorOrigins; if (a && a.length) return `${a[0]}/`; } catch { /* ignore */ }
    try { return window.top.location.href; } catch { /* cross-origin parent */ }
    return document.referrer || href;
  }

  function loadPolicy(force) {
    if (force || !policyPromise) {
      policyPromise = WX.send('getPolicy', { url: pageUrl() })
        .then((p) => { policy = p || { active: false }; if (p?.brand) WX.setBrand(p.brand); return policy; })
        .catch(() => { policy = { active: false, reason: 'unavailable' }; return policy; });
    }
    return policyPromise;
  }
  loadPolicy();
  try {
    WX.api.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'dlp:policyChanged') loadPolicy(true);
    });
  } catch { /* context invalidated */ }

  // -------------------------------------------------------------------------
  // Scanning helpers
  // -------------------------------------------------------------------------
  function scanText(text, p) {
    if (!text) return [];
    return D.scan(text, { ...p.detector, withFingerprints: true })
      .map((d) => ({ ...d, action: p.actions[d.ruleId] || 'off' }))
      .filter((d) => d.action !== 'off');
  }

  function merge(into, dets) {
    for (const d of dets) {
      const cur = into.find((x) => x.ruleId === d.ruleId);
      if (!cur) { into.push({ ...d, samples: [...d.samples], fingerprints: [...(d.fingerprints || [])] }); continue; }
      cur.count += d.count;
      for (const s of d.samples) if (cur.samples.length < 3 && !cur.samples.includes(s)) cur.samples.push(s);
      cur.fingerprints.push(...(d.fingerprints || []));
    }
    return into;
  }

  const isTextLike = (f) => D.isTextLikeFile(f.name, f.type);

  /** File names (always) + contents of text-like files (async). */
  async function scanFiles(files, p) {
    const out = scanFileNames(files, p);
    for (const f of files) {
      if (!isTextLike(f)) continue;
      try {
        const blob = f.size > p.maxFileBytes ? f.slice(0, p.maxFileBytes) : f;
        merge(out, scanText(await blob.text(), p));
      } catch { /* unreadable file: names were still scanned */ }
    }
    return out;
  }

  function scanFileNames(files, p) {
    const out = merge([], scanText(files.map((f) => f.name).join('\n'), p));
    if (files.length && (p.fileUploadPolicy === 'warn' || p.fileUploadPolicy === 'block')) {
      out.push({ ruleId: 'file-upload', ruleName: 'File upload to a high-risk site', count: files.length, samples: [], fingerprints: [], action: p.fileUploadPolicy });
    }
    return out;
  }

  const topAction = (dets) => dets.reduce((a, d) => (RANK[d.action] > RANK[a] ? d.action : a), 'off');

  // -------------------------------------------------------------------------
  // Decisions, modal and logging
  // -------------------------------------------------------------------------
  const VERB = { paste: 'paste', drop: 'drop', upload: 'upload', submit: 'send' };
  const NOUN = { paste: 'text', drop: 'content', upload: 'file', submit: 'message' };
  const PAST = { paste: 'pasted', drop: 'dropped', upload: 'uploaded', submit: 'sent' };

  function log(channel, dets, action, decision, justification = '') {
    const p = policy || {};
    WX.send('logIncident', {
      url: pageUrl(),
      channel,
      detections: dets.map(({ ruleId, ruleName, count }) => ({ ruleId, ruleName, count })),
      action,
      decision,
      justification,
      highRisk: !!p.isHighRisk,
    }).catch(() => {});
  }

  function titleFor(dets) {
    const rules = dets.filter((d) => d.ruleId !== 'file-upload');
    if (!rules.length) return 'File upload to a high-risk site';
    if (rules.length > 1) return 'Sensitive data detected';
    const meta = D.get(rules[0].ruleId);
    return meta ? meta.title : `${rules[0].ruleName} detected`;
  }

  /**
   * Shows the warn/block modal (or logs silently). Resolves true when the
   * content may continue into the page.
   */
  async function decide(channel, dets, { fileNames = [] } = {}) {
    const p = policy;
    const action = topAction(dets);
    if (action === 'off') return true;
    if (action === 'log') { log(channel, dets, 'log', 'logged'); return true; }

    const brand = WX.getBrand();
    const company = brand.companyName || 'your organization';
    const domain = p.domain || location.hostname || 'this site';
    const onlyUploadRule = dets.every((d) => d.ruleId === 'file-upload');
    const details = dets.map((d) => ({
      label: d.ruleId === 'file-upload' ? 'File upload policy' : d.count > 1 ? `${d.ruleName} ×${d.count}` : d.ruleName,
      value: d.ruleId === 'file-upload' ? `${d.count} file${d.count === 1 ? '' : 's'}` : (d.samples.join('   ') || 'match found'),
    }));
    if (fileNames.length) details.push({ label: fileNames.length > 1 ? 'Files' : 'File', value: fileNames.slice(0, 4).join(', ') + (fileNames.length > 4 ? ` +${fileNames.length - 4}` : '') });
    details.push({ label: 'Destination', value: `${domain}${p.isHighRisk ? ' · high-risk' : ''}` });

    const highRiskNote = p.isHighRisk ? ` ${domain} is a high-risk destination (public AI tool, personal e-mail, file sharing or messaging).` : '';
    let message;
    if (action === 'block') {
      message = onlyUploadRule
        ? `Uploading files to ${domain} is blocked by ${company} policy. Nothing was uploaded.`
        : `Sharing this kind of data with ${domain} is blocked by ${company} policy. Nothing was ${PAST[channel]}.`;
    } else {
      message = onlyUploadRule
        ? `You're about to upload ${fileNames.length === 1 ? 'a file' : 'files'} to ${domain}.${highRiskNote} Make sure the content is allowed to leave ${company}.`
        : `The ${NOUN[channel]} you're about to ${VERB[channel]} contains sensitive data.${highRiskNote} Only continue if you're sure it's allowed here.`;
    }

    const needReason = action === 'warn' && p.requireJustification;
    const actions = action === 'block'
      ? [{ label: 'OK', value: 'ok', variant: 'primary' }]
      : [
        ...(p.allowSnooze ? [{ label: `Pause ${p.snoozeMinutes} min here`, value: 'snooze', variant: 'ghost', requiresInput: needReason }] : []),
        { label: 'Continue anyway', value: 'proceed', variant: '', requiresInput: needReason },
        { label: 'Cancel', value: 'cancel', variant: 'primary' },
      ];

    const res = await WX.modal({
      title: titleFor(dets),
      message,
      tone: action === 'block' ? 'danger' : 'warning',
      icon: 'shield',
      product: p.product || 'Data Leak Guard',
      details,
      input: needReason ? { label: 'Why do you need to share this?', placeholder: 'e.g. Sending a customer their own account details', required: true, hint: 'Your reason is recorded with this alert. The content itself is never stored.' } : null,
      actions,
      footer: action === 'block' ? 'Contact IT if you think this is a mistake.' : 'Only the rule name and count are recorded, never the content.',
      dismissValue: action === 'block' ? 'ok' : 'cancel',
    });

    if (action === 'block') { log(channel, dets, 'block', 'blocked'); return false; }
    if (res.value === 'proceed' || res.value === 'snooze') {
      for (const d of dets) for (const f of d.fingerprints || []) approved.add(f);
      let reason = res.input || '';
      if (res.value === 'snooze') {
        try { await WX.send('snooze', { domain: p.domain, minutes: p.snoozeMinutes }); } catch { /* not allowed */ }
        reason = reason ? `${reason} (paused protection ${p.snoozeMinutes} min)` : `Paused protection ${p.snoozeMinutes} min`;
      }
      log(channel, dets, 'warn', 'proceeded', reason);
      return true;
    }
    log(channel, dets, 'warn', 'cancelled');
    WX.toast(`Cancelled. Nothing was ${PAST[channel]}.`, { tone: 'success', timeout: 3000 });
    return false;
  }

  async function run(fn) {
    busy = true;
    try { await fn(); } catch (err) { console.warn('[Data Leak Guard]', err); } finally { busy = false; }
  }

  function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  // -------------------------------------------------------------------------
  // Focus, selection and insertion helpers
  // -------------------------------------------------------------------------
  function deepActive() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  const deepTarget = (e) => (e.composedPath ? e.composedPath()[0] : e.target) || e.target;
  const isTextField = (el) => el && ((el.tagName === 'TEXTAREA') || (el.tagName === 'INPUT' && /^(text|search|email|url|tel|password|number|)$/i.test(el.type || '')));
  function editableRoot(el) {
    if (!el || el.nodeType !== 1) el = el?.parentElement;
    if (!el) return null;
    if (isTextField(el)) return el;
    if (el.isContentEditable) {
      let r = el;
      while (r.parentElement && r.parentElement.isContentEditable) r = r.parentElement;
      return r;
    }
    return null;
  }

  function saveSelection(el) {
    if (isTextField(el)) return { el, start: el.selectionStart, end: el.selectionEnd };
    const sel = el?.getRootNode?.()?.getSelection?.() || document.getSelection();
    return { el, range: sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null };
  }
  function restoreSelection(s) {
    if (!s?.el) return;
    try { s.el.focus({ preventScroll: true }); } catch { /* ignore */ }
    try {
      if (s.start != null) s.el.setSelectionRange(s.start, s.end);
      else if (s.range) { const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(s.range); }
    } catch { /* ignore */ }
  }

  function insertText(sel, text) {
    restoreSelection(sel);
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
    if (!ok && isTextField(sel.el)) {
      const el = sel.el;
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? start;
      el.setRangeText(text, start, end, 'end');
      replaying = true;
      try { el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertFromPaste', data: text })); } finally { replaying = false; }
    }
  }

  function dispatchFlagged(target, ev) {
    replaying = true;
    try { target.dispatchEvent(ev); } finally { replaying = false; }
    return ev;
  }

  // -------------------------------------------------------------------------
  // Paste
  // -------------------------------------------------------------------------
  function onPaste(e) {
    if (replaying || e.__dlpReplay) return;
    const p = policy;
    if (p && (!p.active || !p.channels.paste)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain') || '';
    const html = cd.getData('text/html') || '';
    const files = [...(cd.files || [])];
    if (!text && !files.length) return;
    if (busy) { stop(e); return; }

    let syncDets = null;
    if (p) {
      const needsAsync = files.some(isTextLike);
      if (!needsAsync) {
        syncDets = merge(scanText(text, p), files.length ? scanFileNames(files, p) : []);
        const a = topAction(syncDets);
        if (a === 'off') return;
        if (a === 'log') { log('paste', syncDets, 'log', 'logged'); return; }
      }
    }

    stop(e);
    const target = deepActive() || deepTarget(e);
    const ctx = { target, sel: saveSelection(editableRoot(target) || target), text, html, files };
    run(async () => {
      const pol = await loadPolicy();
      let dets = syncDets;
      if (!dets) {
        if (!pol.active || !pol.channels.paste) { replayPaste(ctx); return; }
        dets = merge(scanText(text, pol), files.length ? await scanFiles(files, pol) : []);
      }
      if (await decide('paste', dets, { fileNames: files.map((f) => f.name) })) replayPaste(ctx);
      else restoreSelection(ctx.sel);
    });
  }

  function replayPaste(ctx) {
    restoreSelection(ctx.sel);
    let handled = false;
    try {
      const dt = new DataTransfer();
      if (ctx.text) dt.setData('text/plain', ctx.text);
      if (ctx.html) dt.setData('text/html', ctx.html);
      for (const f of ctx.files) dt.items.add(f);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
      try { ev.__dlpReplay = true; } catch { /* ignore */ }
      handled = dispatchFlagged(ctx.target, ev).defaultPrevented;
    } catch { handled = false; }
    if (!handled && ctx.text) insertText(ctx.sel, ctx.text);
  }

  // -------------------------------------------------------------------------
  // Drag and drop
  // -------------------------------------------------------------------------
  function onDrop(e) {
    if (replaying) return;
    const p = policy;
    if (p && !p.active) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    const wantText = !p || p.channels.drop;
    const wantFiles = !p || p.channels.drop || p.channels.upload;
    if (!wantText && !wantFiles) return;
    const files = wantFiles ? [...(dt.files || [])] : [];
    const text = wantText ? dt.getData('text/plain') || '' : '';
    if (!files.length && !text) return;
    if (busy) { stop(e); return; }
    const channel = files.length ? (p && !p.channels.drop ? 'upload' : 'drop') : 'drop';

    let syncDets = null;
    if (p && !files.some(isTextLike)) {
      syncDets = merge(scanText(text, p), files.length ? scanFileNames(files, p) : []);
      const a = topAction(syncDets);
      if (a === 'off') return;
      if (a === 'log') { log(channel, syncDets, 'log', 'logged'); return; }
    }

    stop(e);
    const ctx = {
      target: deepTarget(e), files, text,
      html: dt.getData('text/html') || '', uriList: dt.getData('text/uri-list') || '',
      point: { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY },
    };
    run(async () => {
      const pol = await loadPolicy();
      let dets = syncDets;
      if (!dets) {
        if (!pol.active) { replayDrop(ctx); return; }
        dets = merge(scanText(text, pol), files.length ? await scanFiles(files, pol) : []);
      }
      if (await decide(channel, dets, { fileNames: files.map((f) => f.name) })) replayDrop(ctx);
    });
  }

  function replayDrop(ctx) {
    const dt = new DataTransfer();
    for (const f of ctx.files) dt.items.add(f);
    if (ctx.text) dt.setData('text/plain', ctx.text);
    if (ctx.html) dt.setData('text/html', ctx.html);
    if (ctx.uriList) dt.setData('text/uri-list', ctx.uriList);
    let ev;
    try { ev = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, composed: true, ...ctx.point }); } catch { ev = null; }
    if (ev) dispatchFlagged(ctx.target, ev);
    if (ev && ev.defaultPrevented) return;
    const t = ctx.target;
    if (t instanceof HTMLInputElement && t.type === 'file' && ctx.files.length) {
      t.files = dt.files;
      fileInputs.set(t, { sig: sigOf(ctx.files), state: 'allowed' });
      dispatchFlagged(t, new Event('input', { bubbles: true, composed: true }));
      dispatchFlagged(t, new Event('change', { bubbles: true }));
      return;
    }
    const root = editableRoot(t);
    if (root && ctx.text) {
      let sel = saveSelection(root);
      try {
        const r = document.caretRangeFromPoint?.(ctx.point.clientX, ctx.point.clientY);
        if (r && !isTextField(root)) sel = { el: root, range: r };
      } catch { /* ignore */ }
      insertText(sel, ctx.text);
    }
  }

  // -------------------------------------------------------------------------
  // File inputs (input + change)
  // -------------------------------------------------------------------------
  const sigOf = (files) => files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|');

  function onFileInput(e) {
    if (replaying) return;
    const el = deepTarget(e);
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') return;
    const p = policy;
    if (p && (!p.active || !p.channels.upload)) return;
    const files = [...(el.files || [])];
    if (!files.length) return;
    const sig = sigOf(files);
    const st = fileInputs.get(el);
    if (st && st.sig === sig) {
      if (st.state === 'scanning') e.stopImmediatePropagation();
      if (st.state === 'allowed' && e.type === 'change') fileInputs.delete(el);
      return;
    }

    if (p && !files.some(isTextLike)) {
      const dets = scanFileNames(files, p);
      const a = topAction(dets);
      if (a === 'off' || a === 'log') {
        if (a === 'log') log('upload', dets, 'log', 'logged');
        fileInputs.set(el, { sig, state: 'allowed' });
        return;
      }
    }

    e.stopImmediatePropagation();
    if (busy) { el.value = ''; return; }
    fileInputs.set(el, { sig, state: 'scanning' });
    run(async () => {
      const pol = await loadPolicy();
      let ok = true;
      if (pol.active && pol.channels.upload) ok = await decide('upload', await scanFiles(files, pol), { fileNames: files.map((f) => f.name) });
      if (!ok) {
        fileInputs.delete(el);
        try { el.value = ''; } catch { /* ignore */ }
        return;
      }
      fileInputs.set(el, { sig, state: 'allowed' });
      dispatchFlagged(el, new Event('input', { bubbles: true, composed: true }));
      dispatchFlagged(el, new Event('change', { bubbles: true }));
      fileInputs.delete(el);
    });
  }

  // -------------------------------------------------------------------------
  // Send / submit (typed text; high-risk sites only, off by default)
  // -------------------------------------------------------------------------
  const notApproved = (dets) => dets.filter((d) => !(d.fingerprints?.length && d.fingerprints.every((f) => approved.has(f))));

  function onKeydown(e) {
    if (replaying || e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing || e.keyCode === 229) return;
    const p = policy;
    if (!p || !p.active || !p.channels.submit) return;
    const field = editableRoot(deepTarget(e));
    if (!field || (field.tagName === 'INPUT')) return; // single-line inputs are covered by the submit listener
    if (busy) { stop(e); return; }
    const text = field.tagName === 'TEXTAREA' ? field.value : field.innerText;
    const dets = notApproved(scanText(text, p));
    const a = topAction(dets);
    if (a === 'off') return;
    if (a === 'log') { dets.forEach((d) => d.fingerprints.forEach((f) => approved.add(f))); log('submit', dets, 'log', 'logged'); return; }
    stop(e);
    const init = { key: e.key, code: e.code, keyCode: 13, which: 13, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true, cancelable: true, composed: true };
    const target = deepTarget(e);
    run(async () => {
      if (!(await decide('submit', dets))) { try { field.focus(); } catch { /* ignore */ } return; }
      try { field.focus(); } catch { /* ignore */ }
      // Chat UIs send on keydown Enter; replay it so the message goes out as the user intended.
      dispatchFlagged(target, new KeyboardEvent('keydown', init));
      dispatchFlagged(target, new KeyboardEvent('keyup', init));
    });
  }

  function onSubmit(e) {
    if (replaying) return;
    const p = policy;
    if (!p || !p.active || !p.channels.submit) return;
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (busy) { stop(e); return; }
    const parts = [];
    for (const el of form.querySelectorAll('textarea, input, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) {
      if (el.tagName === 'INPUT' && !isTextField(el)) continue;
      if (el.tagName === 'INPUT' && el.type === 'password') continue;
      parts.push(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText);
    }
    const dets = notApproved(scanText(parts.join('\n'), p));
    const a = topAction(dets);
    if (a === 'off') return;
    if (a === 'log') { dets.forEach((d) => d.fingerprints.forEach((f) => approved.add(f))); log('submit', dets, 'log', 'logged'); return; }
    stop(e);
    const submitter = e.submitter || null;
    run(async () => {
      if (!(await decide('submit', dets))) return;
      replaying = true;
      try { form.requestSubmit(submitter && submitter.form === form ? submitter : undefined); } catch { form.submit(); } finally { replaying = false; }
    });
  }

  // -------------------------------------------------------------------------
  // Register everything now (document_start), before the policy arrives.
  // -------------------------------------------------------------------------
  window.addEventListener('paste', onPaste, true);
  window.addEventListener('drop', onDrop, true);
  window.addEventListener('input', onFileInput, true);
  window.addEventListener('change', onFileInput, true);
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('submit', onSubmit, true);
})();
