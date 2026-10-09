import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from './logger.js';

function lastLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const calls = spy.mock.calls;
  return JSON.parse(calls[calls.length - 1][0] as string);
}

describe('logger', () => {
  const originalLevel = process.env.LOG_LEVEL;
  const originalEnv = process.env.NODE_ENV;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.LOG_LEVEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
    process.env.NODE_ENV = originalEnv;
  });

  it('defaults to debug outside production', () => {
    process.env.NODE_ENV = 'development';
    logger.debug('d');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults to info in production (debug suppressed)', () => {
    process.env.NODE_ENV = 'production';
    logger.debug('d');
    logger.info('i');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(lastLine(logSpy).message).toBe('i');
  });

  it('honours LOG_LEVEL', () => {
    process.env.LOG_LEVEL = 'error';
    logger.info('i');
    logger.warn('w');
    expect(logSpy).not.toHaveBeenCalled();
    logger.error('e');
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores an invalid LOG_LEVEL', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'verbose';
    logger.debug('d');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('redacts sensitive meta keys (shallow, case-insensitive)', () => {
    logger.info('x', { password: 'p', refreshToken: 't', Authorization: 'a', cookie: 'c', client_secret: 's', ok: 1 });
    const line = lastLine(logSpy);
    expect(line.password).toBe('[REDACTED]');
    expect(line.refreshToken).toBe('[REDACTED]');
    expect(line.Authorization).toBe('[REDACTED]');
    expect(line.cookie).toBe('[REDACTED]');
    expect(line.client_secret).toBe('[REDACTED]');
    expect(line.ok).toBe(1);
  });

  it('wraps a string meta instead of spreading it char by char', () => {
    logger.info('upload failed', 'disk full' as unknown as Record<string, unknown>);
    const line = lastLine(logSpy);
    expect(line.detail).toBe('disk full');
    expect(line).not.toHaveProperty('0');
    expect(line.message).toBe('upload failed');
  });

  it('meta cannot override timestamp, level or message (meta.message is kept as detail)', () => {
    logger.info('real', { message: 'fake', level: 'error' });
    const line = lastLine(logSpy);
    expect(line.message).toBe('real');
    expect(line.detail).toBe('fake');
    expect(line.level).toBe('info');
  });
});
