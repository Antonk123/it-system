import { useState, useEffect } from 'react';
import { getStoredMode, ModeTheme } from '@/lib/appearance';

/** Custom event name dispatched when mode changes in the same tab */
export const MODE_CHANGE_EVENT = 'app-mode-change';

/** Dispatch this from any code that calls applyMode + saveModeTheme */
export function dispatchModeChange(mode: ModeTheme) {
  window.dispatchEvent(new CustomEvent(MODE_CHANGE_EVENT, { detail: mode }));
}

/**
 * Reactive hook that returns the current ModeTheme.
 * Listens for same-tab custom events and cross-tab storage events.
 */
export function useMode(): ModeTheme {
  const [mode, setMode] = useState<ModeTheme>(getStoredMode);

  useEffect(() => {
    const handleCustom = (e: Event) => {
      const detail = (e as CustomEvent<ModeTheme>).detail;
      setMode(detail);
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'app-mode-theme') {
        setMode((e.newValue as ModeTheme) ?? 'dark');
      }
    };

    window.addEventListener(MODE_CHANGE_EVENT, handleCustom);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(MODE_CHANGE_EVENT, handleCustom);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return mode;
}
