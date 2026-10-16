import { safeStorage } from "@/lib/safeStorage";

// Light/Dark Mode utilities
const MODE_STORAGE_KEY = "app-mode-theme";

export type ModeTheme = "light" | "dark";

export const getStoredMode = (): ModeTheme => {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = safeStorage.getItem(MODE_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "light";
};

export const applyMode = (mode: ModeTheme) => {
  if (typeof document === "undefined") {
    return;
  }

  // Remove both classes first
  document.documentElement.classList.remove("light", "dark");
  // Add the selected mode
  document.documentElement.classList.add(mode);
};

export const saveModeTheme = (mode: ModeTheme) => {
  if (typeof window === "undefined") {
    return;
  }
  safeStorage.setItem(MODE_STORAGE_KEY, mode);
};
