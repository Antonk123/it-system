// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStoredMode } from './appearance';

beforeEach(() => {
  document.documentElement.className = '';
});

afterEach(() => vi.unstubAllGlobals());

describe('blockerad localStorage', () => {
  it('ger standardvärdena i stället för att kasta', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    });
    expect(getStoredMode()).toBe('light');
  });
});
