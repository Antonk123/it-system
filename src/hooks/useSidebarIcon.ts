import { useState, useEffect } from 'react';
import { getStoredSidebarIcon, SidebarIcon, SIDEBAR_ICON_STORAGE_KEY, isSidebarIcon, DEFAULT_SIDEBAR_ICON } from '@/lib/appearance';

export const SIDEBAR_ICON_CHANGE_EVENT = 'app-sidebar-icon-change';

export function dispatchSidebarIconChange(icon: SidebarIcon) {
  window.dispatchEvent(new CustomEvent(SIDEBAR_ICON_CHANGE_EVENT, { detail: icon }));
}

export function useSidebarIcon(): SidebarIcon {
  const [icon, setIcon] = useState<SidebarIcon>(getStoredSidebarIcon);

  useEffect(() => {
    const handleCustom = (e: Event) => {
      const detail = (e as CustomEvent<SidebarIcon>).detail;
      setIcon(detail);
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === SIDEBAR_ICON_STORAGE_KEY) {
        const next = e.newValue;
        setIcon(next && isSidebarIcon(next) ? next : DEFAULT_SIDEBAR_ICON);
      }
    };

    window.addEventListener(SIDEBAR_ICON_CHANGE_EVENT, handleCustom);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(SIDEBAR_ICON_CHANGE_EVENT, handleCustom);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  return icon;
}
