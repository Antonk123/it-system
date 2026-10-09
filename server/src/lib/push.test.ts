import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let memDb: InstanceType<typeof Database>;

vi.mock('../db/connection.js', () => ({
  db: { prepare: (...args: Parameters<InstanceType<typeof Database>['prepare']>) => memDb.prepare(...args) },
}));

vi.mock('./logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { sendNotificationMock, setVapidDetailsMock } = vi.hoisted(() => ({
  sendNotificationMock: vi.fn(async (_sub: unknown, _body: string, _opts: unknown) => ({ statusCode: 201 })),
  setVapidDetailsMock: vi.fn(),
}));
vi.mock('web-push', () => ({
  default: { sendNotification: sendNotificationMock, setVapidDetails: setVapidDetailsMock },
}));

import { initWebPush, isAllowedPushEndpoint, sendPushToAllSubscriptions } from './push.js';
import { logger } from './logger.js';

const payload = { type: 'test', ticketId: 't1', title: 'T', body: 'B' };

const subscribe = (endpoint: string, userId: string | null = 'u1') =>
  memDb
    .prepare('INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(endpoint, endpoint, 'p', 'a', userId);

const endpoints = () =>
  (memDb.prepare('SELECT endpoint FROM push_subscriptions ORDER BY endpoint').all() as { endpoint: string }[]).map(
    (r) => r.endpoint
  );

beforeEach(() => {
  vi.clearAllMocks();
  memDb = new Database(':memory:');
  memDb.exec(`CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, user_id TEXT
  )`);
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:it@example.com';
});

afterEach(() => {
  memDb.close();
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://web.push.apple.com/QAbc',
    'https://wns2-par02p.notify.windows.com/?token=x',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://eu.push.services.mozilla.com/wpush/v2/abc',
  ])('släpper igenom %s', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost:3001/api',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.apple.com.example/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'not a url',
    '',
    42,
    null,
  ])('stoppar %j', (url) => {
    expect(isAllowedPushEndpoint(url)).toBe(false);
  });
});

describe('initWebPush', () => {
  it('aktiveras med giltig konfiguration', () => {
    expect(initWebPush()).toBe(true);
    expect(setVapidDetailsMock).toHaveBeenCalledWith('mailto:it@example.com', 'pub', 'priv');
  });

  it('avaktiveras utan VAPID_SUBJECT i stället för att hitta på en adress', () => {
    delete process.env.VAPID_SUBJECT;

    expect(initWebPush()).toBe(false);
    expect(setVapidDetailsMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('VAPID_SUBJECT'));
  });

  it('avaktiveras utan att kasta när VAPID-nycklarna är felformaterade', () => {
    setVapidDetailsMock.mockImplementationOnce(() => {
      throw new Error('Vapid public key must be a URL safe Base 64');
    });

    expect(initWebPush()).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('sendPushToAllSubscriptions', () => {
  beforeEach(() => {
    initWebPush();
  });

  it('skickar parallellt med timeout och rapporterar sent/failed', async () => {
    subscribe('https://fcm.googleapis.com/a');
    subscribe('https://fcm.googleapis.com/b');
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error('503'), { statusCode: 503 }));

    const result = await sendPushToAllSubscriptions(payload);

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    expect(sendNotificationMock.mock.calls[0][2]).toEqual({ timeout: 10_000 });
    expect(endpoints()).toHaveLength(2);
  });

  it('en seg endpoint blockerar inte de andra (allSettled)', async () => {
    subscribe('https://fcm.googleapis.com/slow');
    subscribe('https://fcm.googleapis.com/fast');
    sendNotificationMock.mockImplementationOnce(() => new Promise(() => undefined));
    // allSettled väntar på den hängande, så vi verifierar bara att båda startades direkt
    void sendPushToAllSubscriptions(payload);
    await Promise.resolve();

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
  });

  it('tar bort prenumerationer som svarar 410/404', async () => {
    subscribe('https://fcm.googleapis.com/gone');
    subscribe('https://fcm.googleapis.com/ok');
    sendNotificationMock.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));

    const result = await sendPushToAllSubscriptions(payload);

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(endpoints()).toEqual(['https://fcm.googleapis.com/ok']);
  });

  it('anropar aldrig en endpoint utanför tillåtlistan och rensar den ur databasen', async () => {
    subscribe('http://169.254.169.254/latest');
    subscribe('https://fcm.googleapis.com/ok');

    const result = await sendPushToAllSubscriptions(payload);

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(endpoints()).toEqual(['https://fcm.googleapis.com/ok']);
  });

  it('filtrerar på användare när userId anges', async () => {
    subscribe('https://fcm.googleapis.com/mine', 'u1');
    subscribe('https://fcm.googleapis.com/theirs', 'u2');

    await sendPushToAllSubscriptions(payload, 'u1');

    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect((sendNotificationMock.mock.calls[0][0] as { endpoint: string }).endpoint).toBe(
      'https://fcm.googleapis.com/mine'
    );
  });
});
