import { describe, it, expect, vi } from 'vitest';
import { resolveNotificationUrl, focusOrOpen, type NavigableClient } from './swNavigation';

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

describe('focusOrOpen', () => {
  it('navigates the existing window to the ticket, then focuses it (iOS single-window fix)', async () => {
    const focus = vi.fn();
    const focused: NavigableClient = { url: '/tickets/xyz', focus };
    const navigate = vi.fn(async () => focused);
    const client: NavigableClient = { url: '/', focus: vi.fn(), navigate };
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([client], openWindow, '/tickets/xyz');

    expect(navigate).toHaveBeenCalledWith('/tickets/xyz');
    expect(focus).toHaveBeenCalledTimes(1); // focuses the client returned by navigate()
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('focuses the original client when navigate() resolves null', async () => {
    const focus = vi.fn();
    const client: NavigableClient = { url: '/', focus, navigate: vi.fn(async () => null) };
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([client], openWindow, '/tickets/1');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('falls back to focus when navigate() rejects', async () => {
    const focus = vi.fn();
    const client: NavigableClient = {
      url: '/',
      focus,
      navigate: vi.fn(async () => { throw new Error('uncontrolled'); }),
    };
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([client], openWindow, '/tickets/1');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('focuses when the client has no navigate() (older engine)', async () => {
    const focus = vi.fn();
    const client: NavigableClient = { url: '/', focus };
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([client], openWindow, '/tickets/1');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens a new window when no client exists', async () => {
    const openWindow = vi.fn(async () => null);

    await focusOrOpen([], openWindow, '/tickets/1');

    expect(openWindow).toHaveBeenCalledWith('/tickets/1');
  });
});
