import { db } from '../db/connection.js';
import { randomUUID, createHmac } from 'crypto';
import { isSafeWebhookUrl } from './webhookValidator.js';
import { logger } from './logger.js';

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string;
  active: number;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  attempts: number;
}

/**
 * Exponential backoff schedule in minutes, indexed by the attempt number that
 * just failed (1-based). After attempt #5 fails we stop retrying.
 *
 *   attempt 1 failed -> retry in  1 min
 *   attempt 2 failed -> retry in  5 min
 *   attempt 3 failed -> retry in 30 min
 *   attempt 4 failed -> retry in  2 h
 *   attempt 5 failed -> give up (no next retry)
 */
const RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 360];
const MAX_WEBHOOK_ATTEMPTS = 5;
// Nyskapad leverans räknas som "förfallen" först efter detta, så en krasch mitt i
// första försöket plockas upp av retry-schedulern utan att den krockar med ett
// pågående försök (fetch-timeout är 10 s).
const FIRST_ATTEMPT_GRACE_MS = 2 * 60_000;

function nextRetryAt(attemptsSoFar: number): string | null {
  if (attemptsSoFar >= MAX_WEBHOOK_ATTEMPTS) return null;
  const minutes = RETRY_DELAYS_MINUTES[attemptsSoFar - 1] ?? null;
  if (minutes === null) return null;
  const when = new Date(Date.now() + minutes * 60_000);
  return when.toISOString();
}

/**
 * Attempt to deliver a single webhook payload to its URL. Updates the
 * webhook_deliveries row in place — does NOT throw. Caller picks the row up
 * again on the next scheduler tick if next_retry_at is set.
 */
async function attemptDelivery(
  webhook: Pick<WebhookRow, 'id' | 'url' | 'secret'>,
  delivery: Pick<DeliveryRow, 'id' | 'event' | 'payload' | 'attempts'>,
): Promise<void> {
  const attemptNumber = delivery.attempts + 1;
  const nowIso = new Date().toISOString();

  // Re-validate URL right before fetch to defeat DNS-rebind attacks where the
  // webhook URL was clean at create-time but its hostname now resolves to an
  // internal IP. A definitive failure here — do not retry.
  //
  // TOCTTOU note: there is a small window between this validation (which does
  // dns.promises.lookup) and the fetch() call below where a hostile DNS server
  // could switch the A record to an internal IP. This residual risk is
  // acceptable because:
  //   1. Webhook URLs are admin-configured — not user/attacker-controlled.
  //   2. Validation happens at delivery time, not just at creation time.
  //   3. Full DNS-pinning (resolve → connect to IP with Host header) would
  //      require a custom http.Agent and complicate TLS certificate validation.
  //      It can be added later as defense-in-depth if the threat model changes.
  const safety = await isSafeWebhookUrl(webhook.url);
  if (!safety.ok) {
    db.prepare(
      'UPDATE webhook_deliveries SET response_code = 0, attempts = ?, next_retry_at = NULL, last_error = ? WHERE id = ?'
    ).run(MAX_WEBHOOK_ATTEMPTS, `URL re-validation failed: ${safety.reason}`, delivery.id);
    return;
  }

  // Signaturschema: HMAC-SHA256(secret, `${timestamp}.${deliveryId}.${body}`), hex,
  // i X-Webhook-Signature. Timestamp (unix-sekunder) och leverans-id skickas som
  // X-Webhook-Timestamp / X-Webhook-Id och ingår i signaturen, så mottagaren kan
  // avvisa gamla (replay) och dubblerade leveranser. Timestamp sätts per försök,
  // leverans-id är detsamma över alla retries.
  // webhook.secret is an HMAC shared signing key stored in readable form —
  // see comment in webhooks.ts for rationale (same pattern as GitHub/Stripe).
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', webhook.secret)
    .update(`${timestamp}.${delivery.id}.${delivery.payload}`)
    .digest('hex');

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
        'X-Webhook-Timestamp': timestamp,
        'X-Webhook-Id': delivery.id,
        'X-Webhook-Event': delivery.event,
      },
      body: delivery.payload,
      signal: AbortSignal.timeout(10000),
      // Följ aldrig redirects: en 3xx kan peka mot en intern adress och kringgå
      // SSRF-valideringen ovan.
      redirect: 'manual',
    });

    if (response.status >= 200 && response.status < 300) {
      db.prepare(
        'UPDATE webhook_deliveries SET response_code = ?, delivered_at = ?, attempts = ?, next_retry_at = NULL, last_error = NULL WHERE id = ?'
      ).run(response.status, nowIso, attemptNumber, delivery.id);

      db.prepare('UPDATE webhooks SET last_triggered_at = ? WHERE id = ?')
        .run(nowIso, webhook.id);

      logger.info('Webhook delivered successfully', {
        webhook_id: webhook.id,
        event: delivery.event,
        status: response.status,
      });
      return;
    }

    // Redirect är ett definitivt fel (följs aldrig) — ingen idé att försöka igen.
    if (response.status >= 300 && response.status < 400) {
      db.prepare(
        'UPDATE webhook_deliveries SET response_code = ?, attempts = ?, next_retry_at = NULL, last_error = ? WHERE id = ?'
      ).run(response.status, MAX_WEBHOOK_ATTEMPTS, `Redirect (HTTP ${response.status}) följs inte`, delivery.id);
      return;
    }

    // Non-2xx response — schedule retry (or give up if we've hit the cap).
    const retryAt = nextRetryAt(attemptNumber);
    db.prepare(
      'UPDATE webhook_deliveries SET response_code = ?, attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?'
    ).run(response.status, attemptNumber, retryAt, `HTTP ${response.status}`, delivery.id);
  } catch (err) {
    // Network error / timeout / DNS failure at fetch time.
    const message = err instanceof Error ? err.message : String(err);
    const retryAt = nextRetryAt(attemptNumber);
    db.prepare(
      'UPDATE webhook_deliveries SET response_code = 0, attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?'
    ).run(attemptNumber, retryAt, message, delivery.id);
  }
}

async function deliverOne(webhook: WebhookRow, event: string, body: string): Promise<void> {
  const deliveryId = randomUUID();

  // Persist the delivery row first so retries survive a process crash. attempts
  // starts at 0; attemptDelivery() increments it. next_retry_at sätts framåt så
  // att en leverans som aldrig hann försökas (krasch) plockas upp av schedulern;
  // attemptDelivery() skriver över värdet vid varje utfall.
  const graceUntil = new Date(Date.now() + FIRST_ATTEMPT_GRACE_MS).toISOString();
  db.prepare(
    'INSERT INTO webhook_deliveries (id, webhook_id, event, payload, attempts, next_retry_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
  ).run(deliveryId, webhook.id, event, body, graceUntil, new Date().toISOString());

  await attemptDelivery(
    { id: webhook.id, url: webhook.url, secret: webhook.secret },
    { id: deliveryId, event, payload: body, attempts: 0 },
  );
}

export async function dispatchWebhook(event: string, payload: Record<string, any>): Promise<void> {
  const webhooks = db.prepare(
    'SELECT id, url, events, secret, active FROM webhooks WHERE active = 1'
  ).all() as WebhookRow[];

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  const matching = webhooks.filter((w) => {
    // En trasig events-rad får inte stoppa övriga webhooks.
    try {
      const events: unknown = JSON.parse(w.events);
      return Array.isArray(events) && (events.includes(event) || events.includes('*'));
    } catch {
      logger.warn('Webhook har ogiltig events-kolumn — hoppas över', { webhook_id: w.id });
      return false;
    }
  });

  const results = await Promise.allSettled(matching.map((w) => deliverOne(w, event, body)));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error('Webhook delivery failed:', { webhook_id: matching[i].id, event, error: String(result.reason) });
    }
  });
}

interface DueDeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  payload: string;
  attempts: number;
  url: string;
  secret: string;
  active: number;
}

/**
 * Picks up undelivered deliveries whose next_retry_at is due and re-attempts
 * them. Called every 60s by webhookRetryScheduler. Drops deliveries whose
 * parent webhook has been deleted or deactivated.
 */
export async function processWebhookRetries(): Promise<void> {
  const now = new Date().toISOString();

  const due = db.prepare(`
    SELECT
      d.id, d.webhook_id, d.event, d.payload, d.attempts,
      w.url, w.secret, w.active
    FROM webhook_deliveries d
    JOIN webhooks w ON w.id = d.webhook_id
    WHERE d.delivered_at IS NULL
      AND d.next_retry_at IS NOT NULL
      AND d.next_retry_at <= ?
      AND d.attempts < ?
  `).all(now, MAX_WEBHOOK_ATTEMPTS) as DueDeliveryRow[];

  if (due.length === 0) return;

  for (const row of due) {
    if (!row.active) {
      // Webhook was deactivated after delivery was queued — stop trying.
      db.prepare(
        'UPDATE webhook_deliveries SET next_retry_at = NULL, last_error = ? WHERE id = ?'
      ).run('Webhook deactivated', row.id);
      continue;
    }

    try {
      await attemptDelivery(
        { id: row.webhook_id, url: row.url, secret: row.secret },
        { id: row.id, event: row.event, payload: row.payload, attempts: row.attempts },
      );
    } catch (err) {
      logger.error('Webhook retry failed:', { delivery_id: row.id, error: String(err) });
    }
  }
}
