import webpush from 'web-push';
import { db } from '../db/connection.js';

let pushEnabled = false;

export function initWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@prefabmastarna.se';
  if (!publicKey || !privateKey) {
    console.warn('Push notifications disabled (VAPID keys not configured)');
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
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
}

export async function sendPushToAllSubscriptions(payload: PushPayload): Promise<void> {
  if (!pushEnabled) return;
  const subs = db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all() as
    { endpoint: string; p256dh: string; auth: string }[];
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload)
      );
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
        console.log(`Removed expired push subscription: ${sub.endpoint}`);
      } else {
        console.error('Push send error:', err.message);
      }
    }
  }
}
