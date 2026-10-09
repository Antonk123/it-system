import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let memDb: InstanceType<typeof Database>;

vi.mock('../db/connection.js', () => ({
  db: { prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) => memDb.prepare(...args) },
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// node-cron ersätts så att testet själv kör tick-callbacken.
let tick: () => Promise<void>;
vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, fn: () => Promise<void>) => {
      tick = fn;
      return { stop: vi.fn() };
    },
  },
}));

const { sendReminderMock, sendPushMock } = vi.hoisted(() => ({
  sendReminderMock: vi.fn(async (_data: unknown) => undefined),
  sendPushMock: vi.fn(async (_payload: unknown, _userId?: string) => ({ sent: 1, failed: 0 })),
}));
vi.mock('./email.js', () => ({ sendTicketReminderEmail: sendReminderMock }));
vi.mock('./push.js', () => ({ sendPushToAllSubscriptions: sendPushMock }));

import { startReminderScheduler, stopReminderScheduler } from './reminderScheduler.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');

function insertReminder(id: string, reminderTime: string, userId = 'u1') {
  memDb
    .prepare('INSERT INTO ticket_reminders (id, ticket_id, user_id, reminder_time, message) VALUES (?, ?, ?, ?, ?)')
    .run(id, 't1', userId, reminderTime, 'Glöm inte');
}

const reminderRow = (id: string) =>
  memDb.prepare('SELECT sent, sent_at, attempts FROM ticket_reminders WHERE id = ?').get(id) as {
    sent: number;
    sent_at: string | null;
    attempts: number;
  };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.EMAIL_FROM = 'support@example.com';

  memDb = new Database(':memory:');
  memDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT);
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT, priority TEXT, category_id TEXT
    );
    CREATE TABLE ticket_reminders (
      id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, user_id TEXT NOT NULL, reminder_time TEXT NOT NULL,
      message TEXT, sent INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, sent_at TEXT DEFAULT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO users VALUES ('u1', 'agent@example.com', 'Agent');
    INSERT INTO tickets VALUES ('t1', 'Skrivare', 'Beskrivning', 'open', 'medium', NULL);
  `);
  startReminderScheduler();
});

afterEach(() => {
  stopReminderScheduler();
  memDb.close();
  vi.useRealTimers();
  delete process.env.SMTP_HOST;
  delete process.env.EMAIL_FROM;
});

describe('reminderScheduler', () => {
  it('skickar mail och markerar förfallen påminnelse som skickad; framtida lämnas orörd', async () => {
    insertReminder('due', '2026-10-09T11:59:00.000Z');
    insertReminder('future', '2026-10-09T13:00:00.000Z');

    await tick();

    expect(sendReminderMock).toHaveBeenCalledTimes(1);
    expect(reminderRow('due')).toMatchObject({ sent: 1 });
    expect(reminderRow('due').sent_at).toBe(NOW.toISOString());
    expect(reminderRow('future').sent).toBe(0);
  });

  it('skickar personliga påminnelser bara till ägarens push-prenumerationer', async () => {
    insertReminder('due', '2026-10-09T11:59:00.000Z');

    await tick();

    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock.mock.calls[0][1]).toBe('u1');
  });

  it('behåller sent=0 och skickar ingen push när mailet misslyckas, och försöker igen nästa minut', async () => {
    insertReminder('due', '2026-10-09T11:59:00.000Z');
    sendReminderMock.mockRejectedValueOnce(new Error('smtp nere'));

    await tick();

    expect(reminderRow('due').sent).toBe(0);
    expect(sendPushMock).not.toHaveBeenCalled();

    await tick();

    expect(reminderRow('due').sent).toBe(1);
    expect(sendReminderMock).toHaveBeenCalledTimes(2);
  });

  it('räknar misslyckade försök och ger upp efter det femte', async () => {
    insertReminder('stale', '2026-10-09T11:00:00.000Z');
    sendReminderMock.mockRejectedValue(new Error('adressen finns inte'));

    for (let i = 1; i <= 4; i++) {
      await tick();
      expect(reminderRow('stale').sent).toBe(0);
      expect(reminderRow('stale').attempts).toBe(i);
    }
    await tick();

    expect(reminderRow('stale').sent).toBe(1);
    expect(reminderRow('stale').attempts).toBe(5);
    await tick();
    expect(sendReminderMock).toHaveBeenCalledTimes(5);
  });

  it('kör inte överlappande tickar medan en tidigare fortfarande pågår', async () => {
    insertReminder('due', '2026-10-09T11:59:00.000Z');
    let release!: () => void;
    sendReminderMock.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));

    const first = tick();
    await tick();

    expect(sendReminderMock).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(reminderRow('due').sent).toBe(1);
  });
});
