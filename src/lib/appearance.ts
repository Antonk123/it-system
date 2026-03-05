export const FONT_STORAGE_KEY = "app-font-theme";

export const FONT_OPTIONS = [
  { value: "font-jakarta", label: "Plus Jakarta Sans (standard)" },
  { value: "font-crimson", label: "Crimson Pro" },
  { value: "font-libre", label: "Libre Caslon" },
  { value: "font-jetbrains", label: "JetBrains Mono" },
] as const;

export type FontTheme = (typeof FONT_OPTIONS)[number]["value"];

const fontClassSet = new Set<string>(FONT_OPTIONS.map((option) => option.value));

export const isFontTheme = (value: string): value is FontTheme => fontClassSet.has(value);

export const getStoredFontTheme = (): FontTheme => {
  if (typeof window === "undefined") {
    return "font-jakarta";
  }

  const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
  return stored && isFontTheme(stored) ? stored : "font-jakarta";
};

export const applyFontTheme = (fontTheme: FontTheme) => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.remove(...FONT_OPTIONS.map((option) => option.value));
  document.documentElement.classList.add(fontTheme);
};

export const saveFontTheme = (fontTheme: FontTheme) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(FONT_STORAGE_KEY, fontTheme);
};

// Light/Dark Mode utilities
export const MODE_STORAGE_KEY = "app-mode-theme";

export type ModeTheme = "light" | "dark";

export const getStoredMode = (): ModeTheme => {
  if (typeof window === "undefined") {
    return "dark";
  }

  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "dark";
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
  window.localStorage.setItem(MODE_STORAGE_KEY, mode);
};
