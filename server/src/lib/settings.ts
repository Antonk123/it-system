import { db } from '../db/connection.js';

/**
 * Generic key-value runtime settings (table app_settings, migration 064).
 * Single source of truth for reading/writing system settings outside env vars.
 */

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function getBoolSetting(key: string, fallback: boolean): boolean {
  const v = getSetting(key);
  if (v === null) return fallback;
  return v === '1';
}

/**
 * Shared gate for the customer-facing email senders. Today it's a plain on/off
 * read of two_way_email_enabled and IGNORES the recipient. The recipient arg is
 * here so a future "internal-only" mode (only @prefabmastarna.se) is a one-place
 * change — see docs/superpowers/specs/2026-06-26-two-way-email-toggle-design.md.
 */
export function shouldEmailCustomer(_recipientEmail: string): boolean {
  return getBoolSetting('two_way_email_enabled', true);
}
