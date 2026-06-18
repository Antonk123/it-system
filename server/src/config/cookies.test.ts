import { describe, it, expect, afterEach } from 'vitest';
import { cookieSecure } from './cookies.js';

describe('cookieSecure', () => {
  const origSecure = process.env.COOKIE_SECURE;
  const origNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (origSecure === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = origSecure;
    process.env.NODE_ENV = origNodeEnv;
  });

  it('honours an explicit COOKIE_SECURE=true', () => {
    process.env.COOKIE_SECURE = 'true';
    process.env.NODE_ENV = 'development';
    expect(cookieSecure()).toBe(true);
  });

  it('honours an explicit COOKIE_SECURE=false even in production', () => {
    process.env.COOKIE_SECURE = 'false';
    process.env.NODE_ENV = 'production';
    expect(cookieSecure()).toBe(false);
  });

  it('falls back to NODE_ENV=production when COOKIE_SECURE is unset', () => {
    delete process.env.COOKIE_SECURE;
    process.env.NODE_ENV = 'production';
    expect(cookieSecure()).toBe(true);
  });

  it('is non-secure outside production when COOKIE_SECURE is unset', () => {
    delete process.env.COOKIE_SECURE;
    process.env.NODE_ENV = 'development';
    expect(cookieSecure()).toBe(false);
  });
});
