// Ticket Snap background service worker.
// Captures the visible tab (popup, keyboard shortcut or context menu), stores
// the image + page context in storage.session and opens the annotator.

import { api, extUrl, uuid } from './shared/browser.js';
import { loadSettings, onSettingsChanged } from './shared/config.js';
import { handleMessages } from './shared/messaging.js';
import { isRestrictedUrl } from './shared/domain.js';
import { DEFAULTS } from './defaults.js';
import { putCapture, pruneCaptures } from './lib/capture-store.js';

const MENU_PAGE = 'ticket-snap:report-page';
const MENU_TEXT = 'ticket-snap:report-text';
const MAX_PNG_CHARS = 7 * 1024 * 1024; // above this, re-capture as JPEG to fit storage quotas

// ---------------------------------------------------------------------------
// Context menus (rebuilt whenever settings change)
// ---------------------------------------------------------------------------
let menuChain = Promise.resolve();
function setupMenus() {
  menuChain = menuChain.then(async () => {
    const { values } = await loadSettings(DEFAULTS);
    await api.contextMenus.removeAll();
    if (!values.showContextMenu) return;
    const ignore = () => void api.runtime.lastError;
    api.contextMenus.create({ id: MENU_PAGE, title: 'Report a problem with this page', contexts: ['page', 'frame', 'selection', 'link', 'image', 'editable'] }, ignore);
    api.contextMenus.create({ id: MENU_TEXT, title: 'Report a problem (no screenshot)', contexts: ['action'] }, ignore);
  }).catch((err) => console.warn('Ticket Snap: menu setup failed', err));
  return menuChain;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
function friendlyCaptureError(err, url) {
  const msg = String(err?.message || err || '');
  if ((url && isRestrictedUrl(url)) || /cannot be scripted|chrome:\/\/|edge:\/\/|about:|extensions gallery|Cannot access contents|permission/i.test(msg)) {
    return 'Browser pages, extension stores and other extensions’ pages can’t be captured. You can still describe the problem, or paste a screenshot.';
  }
  return `The screenshot couldn’t be taken (${msg || 'unknown error'}). You can still describe the problem.`;
}

async function activeTab() {
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function captureTab(tab, { screenshot = true } = {}) {
  tab ||= await activeTab();
  const id = uuid();
  const context = {
    url: tab?.url || '',
    title: tab?.title || '',
    viewport: tab?.width ? `${tab.width}×${tab.height}` : '',
    capturedAt: new Date().toISOString(),
  };
  if (tab?.id != null) {
    try { context.zoom = `${Math.round((await api.tabs.getZoom(tab.id)) * 100)}%`; } catch { /* not available */ }
  }

  let image = '';
  let screenshotError = '';
  if (screenshot && tab) {
    try {
      image = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      if (image.length > MAX_PNG_CHARS) image = await api.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 88 });
    } catch (err) {
      screenshotError = friendlyCaptureError(err, tab.url);
    }
  }

  try {
    await putCapture(id, { image, context, screenshotError, requested: screenshot });
  } catch {
    // Storage full even after cleanup: open the form without the image.
    await putCapture(id, { image: '', context, screenshotError: 'The screenshot was too large to keep. You can still describe the problem.', requested: screenshot });
  }

  const own = tab?.url?.startsWith(extUrl(''));
  await api.tabs.create({
    url: extUrl(`annotate.html?id=${encodeURIComponent(id)}`),
    ...(tab && !own ? { index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId } : {}),
  });
  return { id };
}

// ---------------------------------------------------------------------------
// Listeners (registered synchronously at top level)
// ---------------------------------------------------------------------------
api.runtime.onInstalled.addListener(() => { setupMenus(); pruneCaptures(); });
api.runtime.onStartup.addListener(() => { setupMenus(); pruneCaptures(); });
onSettingsChanged(() => setupMenus());

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_PAGE) captureTab(tab, { screenshot: true });
  else if (info.menuItemId === MENU_TEXT) captureTab(tab, { screenshot: false });
});

api.commands.onCommand.addListener((command, tab) => {
  if (command === 'capture-tab') captureTab(tab, { screenshot: true });
});

handleMessages({
  /** From the popup: { tabId?, screenshot } */
  async capture({ tabId, screenshot = true }) {
    let tab = null;
    if (tabId != null) { try { tab = await api.tabs.get(tabId); } catch { tab = null; } }
    return captureTab(tab, { screenshot });
  },
});
