import { api } from './browser.js';

/**
 * Registers background message handlers.
 *   handleMessages({ getConfig: async (msg, sender) => ({...}) })
 * Callers use `send('getConfig', {...})`. Handlers may be sync or async;
 * thrown errors reject the caller's promise with the same message.
 */
export function handleMessages(handlers) {
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !(msg.type in handlers)) return false;
    Promise.resolve()
      .then(() => handlers[msg.type](msg.data ?? {}, sender))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
      );
    return true; // keep the channel open for the async response
  });
}

/** Sends a typed message to the background and unwraps the response. */
export async function send(type, data) {
  const res = await api.runtime.sendMessage({ type, data });
  if (!res) throw new Error(`No handler for "${type}"`);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
