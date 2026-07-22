/**
 * Pure helpers for the service worker's `notificationclick` handling, extracted
 * from sw.ts so they can be unit-tested without a ServiceWorkerGlobalScope
 * (sw.ts runs `precacheAndRoute` at import time and can't be imported in tests).
 * sw.ts wires these to the real `self.clients` API; the app side consumes
 * `SW_NAVIGATE_MESSAGE` via `parseSwNavigateMessage`.
 */

/** Message type the SW posts to the app to request an in-router navigation. */
export const SW_NAVIGATE_MESSAGE = 'sw-navigate';

/** Minimal structural view of a WindowClient — keeps this module DOM-free. */
export interface NavigableClient {
  url: string;
  focus: () => Promise<unknown> | unknown;
  /** Post a message to the controlled page (the app's router listens for it). */
  postMessage?: (message: unknown) => void;
}

/**
 * Only allow a same-origin path or an http(s) target; anything else (e.g. a
 * `javascript:` scheme smuggled into the push payload) collapses to '/'.
 */
export function resolveNotificationUrl(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') return '/';
  const isSafe =
    rawUrl.startsWith('/') || rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
  return isSafe ? rawUrl : '/';
}

/**
 * Parse a message posted by the SW on the app side. Returns a safe same-origin
 * path to navigate to, or null if the message isn't ours / isn't a valid path.
 */
export function parseSwNavigateMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const msg = data as { type?: unknown; url?: unknown };
  if (msg.type !== SW_NAVIGATE_MESSAGE) return null;
  if (typeof msg.url !== 'string' || !msg.url.startsWith('/')) return null;
  return msg.url;
}

/**
 * Route the app to `url` when a notification is clicked.
 *
 * On iOS a standalone PWA is a SINGLE window and `WindowClient.navigate()` is
 * unreliable there (no-op / rejects), so navigating the existing window fails
 * and the user is left on whatever route they last had (e.g. the ticket list).
 * Instead: focus the existing window (which resumes the suspended app) and
 * `postMessage` the target path so the running app navigates via its own React
 * Router — reliable on iOS. Only when NO window exists do we `openWindow()`,
 * where a fresh load renders the target route directly.
 */
export async function focusOrOpen(
  windowClients: readonly NavigableClient[],
  openWindow: (url: string) => Promise<unknown>,
  url: string,
): Promise<void> {
  for (const client of windowClients) {
    if (typeof client.focus !== 'function') continue;
    await client.focus();
    if (typeof client.postMessage === 'function') {
      client.postMessage({ type: SW_NAVIGATE_MESSAGE, url });
    }
    return;
  }
  await openWindow(url);
}
