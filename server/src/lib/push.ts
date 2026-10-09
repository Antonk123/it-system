import webpush from 'web-push';
import { db } from '../db/connection.js';
import { logger } from './logger.js';

let pushEnabled = false;

const SEND_TIMEOUT_MS = 10_000;

// Endast kända push-tjänster får anropas — annars kan en prenumerant få servern
// att skicka POST till godtyckliga interna adresser (SSRF).
const PUSH_HOSTS = ['fcm.googleapis.com'];
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com', '.push.services.mozilla.com'];

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string') return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export function initWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  // VAPID subject identifies the app to push services — install owner's contact
  // email/URL. Saknas den stängs push av hellre än att skicka en påhittad adress.
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey) {
    logger.warn('Push notifications disabled (VAPID keys not configured)');
    return false;
  }
  if (!subject) {
    logger.warn('Push notifications disabled (VAPID_SUBJECT saknas — sätt t.ex. mailto:it@foretaget.se)');
    return false;
  }
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    logger.error('Push notifications disabled (ogiltig VAPID-konfiguration)', { error: String(err) });
    return false;
  }
  pushEnabled = true;
  return true;
}

export function isPushEnabled(): boolean {
  return pushEnabled;
}

interface PushPayload {
  type: string;
  ticketId: string;
  title: string;
  body: string;
  /** Mål vid klick; utan url öppnas /tickets/<ticketId>. */
  url?: string;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function loadPushSubscriptions(userId?: string): PushSubscriptionRow[] {
  return (userId
    ? db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(userId)
    : db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all()) as PushSubscriptionRow[];
}

/** Skickar till givna prenumerationer parallellt; en död eller seg endpoint stoppar inte resten. */
export async function sendPushToSubscriptions(
  subs: PushSubscriptionRow[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!pushEnabled) return { sent: 0, failed: 0 };

  const deleteSub = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');
  const valid = subs.filter((sub) => {
    if (isAllowedPushEndpoint(sub.endpoint)) return true;
    deleteSub.run(sub.endpoint);
    logger.warn('Removed push subscription with disallowed endpoint');
    return false;
  });

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    valid.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { timeout: SEND_TIMEOUT_MS },
      ),
    ),
  );

  let sent = 0;
  let failed = 0;
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      sent++;
      return;
    }
    failed++;
    const err = result.reason as { statusCode?: number; message?: string };
    if (err.statusCode === 410 || err.statusCode === 404) {
      deleteSub.run(valid[i].endpoint);
      logger.info('Removed expired push subscription', { endpoint: valid[i].endpoint });
    } else {
      logger.error('Push send error', { message: err.message });
    }
  });
  return { sent, failed };
}

export async function sendPushToAllSubscriptions(
  payload: PushPayload,
  userId?: string,
): Promise<{ sent: number; failed: number }> {
  if (!pushEnabled) return { sent: 0, failed: 0 };
  return sendPushToSubscriptions(loadPushSubscriptions(userId), payload);
}
