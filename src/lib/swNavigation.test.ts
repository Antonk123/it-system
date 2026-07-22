import { describe, it, expect, vi } from 'vitest';
import {
  resolveNotificationUrl,
  parseSwNavigateMessage,
  focusOrOpen,
  SW_NAVIGATE_MESSAGE,
  type NavigableClient,
} from './swNavigation';

describe('resolveNotificationUrl', () => {
  it('keeps a same-origin ticket path', () => {
    expect(resolveNotificationUrl('/tickets/abc123')).toBe('/tickets/abc123');
  });

  it('keeps http(s) targets', () => {
    expect(resolveNotificationUrl('https://ticket.example.se/tickets/1')).toBe(
      'https://ticket.example.se/tickets/1',
    );
  });

  it('collapses dangerous schemes to /', () => {
    expect(resolveNotificationUrl('javascript:alert(1)')).toBe('/');
  });

  it('collapses missing/non-string data to /', () => {
    expect(resolveNotificationUrl(undefined)).toBe('/');
    expect(resolveNotificationUrl(null)).toBe('/');
    expect(resolveNotificationUrl(42)).toBe('/');
  });
});

describe('parseSwNavigateMessage', () => {
  it('extracts a same-origin path from a valid message', () => {
    expect(parseSwNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: '/tickets/1' })).toBe(
      '/tickets/1',
    );
  });

  it('ignores messages of the wrong type', () => {
    expect(parseSwNavigateMessage({ type: 'other', url: '/tickets/1' })).toBeNull();
  });

  it('rejects non-path urls (no in-app navigation to absolute/dangerous targets)', () => {
    expect(parseSwNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: 'https://evil.example' })).toBeNull();
    expect(parseSwNavigateMessage({ type: SW_NAVIGATE_MESSAGE, url: 'javascript:x' })).toBeNull();
  });

  it('handles junk input safely', () => {
    expect(parseSwNavigateMessage(undefined)).toBeNull();
    expect(parseSwNavigateMessage('string')).toBeNull();
    expect(parseSwNavigateMessage({ type: SW_NAVIGATE_MESSAGE })).toBeNull();
  });
});

describe('focusOrOpen', () => {
  it('focuses the existing window and posts an sw-navigate message (iOS-safe deep link)', async () => {
    const focus = vi.fn();
    const postMessage = vi.fn();
    const client: NavigableClient = { url: '/tickets', focus, postMessage };
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([client], openWindow, '/tickets/xyz');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({ type: SW_NAVIGATE_MESSAGE, url: '/tickets/xyz' });
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('focuses the window even when it cannot postMessage (older client)', async () => {
    const focus = vi.fn();
    const client: NavigableClient = { url: '/', focus };
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([client], openWindow, '/tickets/1');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window at the target url when no client exists', async () => {
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([], openWindow, '/tickets/1');

    expect(openWindow).toHaveBeenCalledWith('/tickets/1');
  });
});
