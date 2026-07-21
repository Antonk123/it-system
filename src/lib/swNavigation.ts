/**
 * Pure helpers for the service worker's `notificationclick` handling, extracted
 * from sw.ts so they can be unit-tested without a ServiceWorkerGlobalScope
 * (sw.ts runs `precacheAndRoute` at import time and can't be imported in tests).
 * sw.ts wires these to the real `self.clients` API.
 */

/** Minimal structural view of a WindowClient — keeps this module DOM-free. */
export interface NavigableClient {
  url: string;
  focus: () => Promise<unknown> | unknown;
  /** Present on controlled window clients (iOS 16.4+ / modern engines). */
  navigate?: (url: string) => Promise<NavigableClient | null>;
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
 * Route the app to `url` when a notification is clicked.
 *
 * On iOS a standalone PWA is a SINGLE window: `clients.openWindow()` cannot
 * force navigation, so it just brings the existing window to the foreground at
 * whatever route it was on (usually the start page). The fix: if a window
 * already exists, `navigate()` it to the target first, then focus. Only when no
 * window exists do we `openWindow()`. `navigate()` can reject on an
 * uncontrolled/cross-origin client — we fall back to a plain focus so the user
 * at least lands in the app.
 */
export async function focusOrOpen(
  windowClients: readonly NavigableClient[],
  openWindow: (url: string) => Promise<unknown>,
  url: string,
): Promise<void> {
  for (const client of windowClients) {
    if (typeof client.focus !== 'function') continue;
    if (typeof client.navigate === 'function') {
      try {
        const navigated = await client.navigate(url);
        await (navigated ?? client).focus();
        return;
      } catch {
        // navigate() rejected (uncontrolled/cross-origin) — fall back to focus.
      }
    }
    await client.focus();
    return;
  }
  await openWindow(url);
}
