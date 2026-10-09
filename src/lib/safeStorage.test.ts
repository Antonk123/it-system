// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeSessionStorage, safeStorage } from './safeStorage';

const blockedStorage = () => ({
  getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
  setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
  removeItem: () => { throw new DOMException('blocked', 'SecurityError'); },
});

afterEach(() => vi.unstubAllGlobals());

describe('safeStorage', () => {
  it('läser, skriver och tar bort mot en fungerande storage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });

    safeStorage.setItem('k', 'v');
    expect(safeStorage.getItem('k')).toBe('v');
    safeStorage.removeItem('k');
    expect(safeStorage.getItem('k')).toBeNull();
  });

  it('kastar aldrig när storage är blockerad: läsning ger null, skrivning och borttagning är no-op', () => {
    vi.stubGlobal('localStorage', blockedStorage());
    vi.stubGlobal('sessionStorage', blockedStorage());

    expect(safeStorage.getItem('k')).toBeNull();
    expect(() => safeStorage.setItem('k', 'v')).not.toThrow();
    expect(() => safeStorage.removeItem('k')).not.toThrow();
    expect(safeSessionStorage.getItem('k')).toBeNull();
    expect(() => safeSessionStorage.setItem('k', 'v')).not.toThrow();
  });

  it('klarar att själva åtkomsten till storage-objektet kastar', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() { throw new DOMException('blocked', 'SecurityError'); },
    });
    try {
      expect(safeSessionStorage.getItem('k')).toBeNull();
    } finally {
      // @ts-expect-error återställer testets egenskap så jsdoms egen återtas
      delete globalThis.sessionStorage;
    }
  });
});
