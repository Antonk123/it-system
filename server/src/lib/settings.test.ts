import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { existsSync, rmSync } from 'fs';

const { DB_PATH } = vi.hoisted(() => {
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  const dbPath = join(tmpdir(), `itticket-test-${process.pid}-${Date.now()}-settings.sqlite`);
  process.env.DB_PATH = dbPath;
  process.env.NODE_ENV = 'test';
  return { DB_PATH: dbPath };
});

import { initializeDatabase, closeDatabase } from '../db/connection.js';
import { getSetting, setSetting, getBoolSetting, shouldEmailCustomer } from './settings.js';

beforeAll(() => {
  initializeDatabase();
});

afterAll(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  for (const s of ['', '-wal', '-shm']) {
    const f = DB_PATH + s;
    if (existsSync(f)) { try { rmSync(f); } catch { /* ignore */ } }
  }
});

describe('settings service', () => {
  it('seeds two_way_email_enabled=1 via migration 064 (default on)', () => {
    expect(getSetting('two_way_email_enabled')).toBe('1');
    expect(getBoolSetting('two_way_email_enabled', false)).toBe(true);
  });

  it('returns the fallback for an unknown key', () => {
    expect(getSetting('does_not_exist')).toBeNull();
    expect(getBoolSetting('does_not_exist', true)).toBe(true);
    expect(getBoolSetting('does_not_exist', false)).toBe(false);
  });

  it('setSetting upserts and getBoolSetting parses 1/0', () => {
    setSetting('two_way_email_enabled', '0');
    expect(getSetting('two_way_email_enabled')).toBe('0');
    expect(getBoolSetting('two_way_email_enabled', true)).toBe(false);

    setSetting('two_way_email_enabled', '1');
    expect(getBoolSetting('two_way_email_enabled', false)).toBe(true);
  });

  it('shouldEmailCustomer reflects the setting (recipient ignored for now)', () => {
    setSetting('two_way_email_enabled', '0');
    expect(shouldEmailCustomer('anyone@example.com')).toBe(false);
    setSetting('two_way_email_enabled', '1');
    expect(shouldEmailCustomer('anyone@example.com')).toBe(true);
  });
});
