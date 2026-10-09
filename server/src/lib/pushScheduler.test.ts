import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let memDb: InstanceType<typeof Database>;

vi.mock('../db/connection.js', () => ({
  db: { prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) => memDb.prepare(...args) },
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let tick: () => Promise<void>;
vi.mock('node-cron', () => ({
  default: {
    schedule: (_expr: string, fn: () => Promise<void>) => {
      tick = fn;
      return { stop: vi.fn() };
    },
  },
}));

const { loadMock, sendMock } = vi.hoisted(() => ({
  loadMock: vi.fn(() => [{ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' }]),
  sendMock: vi.fn(async (_subs: unknown, _payload: unknown) => ({ sent: 1, failed: 0 })),
}));
vi.mock('./push.js', () => ({
  isPushEnabled: () => true,
  loadPushSubscriptions: loadMock,
  sendPushToSubscriptions: sendMock,
}));

import { startPushScheduler, stopPushScheduler } from './pushScheduler.js';

const NOW = new Date('2026-10-09T09:00:00.000Z');

const notifiedAt = (id: string) =>
  (memDb.prepare('SELECT last_aging_notified_at AS at FROM tickets WHERE id = ?').get(id) as { at: string | null }).at;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  loadMock.mockReturnValue([{ endpoint: 'https://fcm.googleapis.com/x', p256dh: 'p', auth: 'a' }]);

  memDb = new Database(':memory:');
  memDb.exec(`
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY, title TEXT, status TEXT, updated_at TEXT, last_aging_notified_at TEXT
    );
    INSERT INTO tickets VALUES ('old1', 'Gammalt 1', 'open', '2026-09-01T00:00:00.000Z', NULL);
    INSERT INTO tickets VALUES ('old2', 'Gammalt 2', 'open', '2026-09-02T00:00:00.000Z', NULL);
    INSERT INTO tickets VALUES ('fresh', 'Nytt', 'open', '2026-10-08T00:00:00.000Z', NULL);
    INSERT INTO tickets VALUES ('done', 'Löst', 'resolved', '2026-09-01T00:00:00.000Z', NULL);
  `);
  startPushScheduler();
});

afterEach(() => {
  stopPushScheduler();
  memDb.close();
  vi.useRealTimers();
});

describe('pushScheduler aging check', () => {
  it('hämtar prenumerationerna en gång per körning och markerar bara inaktiva, öppna ärenden', async () => {
    await tick();

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(notifiedAt('old1')).toBe(NOW.toISOString());
    expect(notifiedAt('old2')).toBe(NOW.toISOString());
    expect(notifiedAt('fresh')).toBeNull();
    expect(notifiedAt('done')).toBeNull();
  });

  it('markerar inte ärendet när alla pushar misslyckades, så nästa körning försöker igen', async () => {
    sendMock.mockResolvedValue({ sent: 0, failed: 1 });

    await tick();

    expect(notifiedAt('old1')).toBeNull();
    expect(notifiedAt('old2')).toBeNull();
  });

  it('markerar bara de ärenden där minst en push gick fram', async () => {
    sendMock.mockResolvedValueOnce({ sent: 1, failed: 0 }).mockResolvedValueOnce({ sent: 0, failed: 2 });

    await tick();

    expect(notifiedAt('old1')).toBe(NOW.toISOString());
    expect(notifiedAt('old2')).toBeNull();
  });

  it('gör ingenting när ingen har prenumererat', async () => {
    loadMock.mockReturnValue([]);

    await tick();

    expect(sendMock).not.toHaveBeenCalled();
    expect(notifiedAt('old1')).toBeNull();
  });
});
