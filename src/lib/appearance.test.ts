// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyFontTheme, getStoredFontTheme, getStoredMode } from './appearance';

beforeEach(() => {
  document.head.querySelectorAll('link[data-font-theme]').forEach((link) => link.remove());
  document.documentElement.className = '';
});

afterEach(() => vi.unstubAllGlobals());

describe('typsnitt laddas först när de väljs', () => {
  it('Inter (standard) injicerar ingen länk — index.html laddar den', () => {
    applyFontTheme('font-inter');
    expect(document.head.querySelectorAll('link[data-font-theme]')).toHaveLength(0);
    expect(document.documentElement.classList.contains('font-inter')).toBe(true);
  });

  it.each([
    ['font-jakarta', 'Plus+Jakarta+Sans'],
    ['font-crimson', 'Crimson+Pro'],
    ['font-libre', 'Libre+Caslon+Text'],
    ['font-jetbrains', 'JetBrains+Mono'],
  ] as const)('%s lägger till sitt stilmall en gång', (fontTheme, family) => {
    applyFontTheme(fontTheme);
    applyFontTheme(fontTheme);
    const links = document.head.querySelectorAll<HTMLLinkElement>(`link[data-font-theme="${fontTheme}"]`);
    expect(links).toHaveLength(1);
    expect(links[0].href).toContain(`family=${family}`);
    expect(links[0].rel).toBe('stylesheet');
  });
});

describe('blockerad localStorage', () => {
  it('ger standardvärdena i stället för att kasta', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    });
    expect(getStoredFontTheme()).toBe('font-inter');
    expect(getStoredMode()).toBe('light');
  });
});
