export const FONT_STORAGE_KEY = "app-font-theme";

export const FONT_OPTIONS = [
  { value: "font-inter", label: "Inter (standard)" },
  { value: "font-roboto", label: "Roboto" },
  { value: "font-libre", label: "Libre Caslon" },
  { value: "font-mono", label: "Roboto Mono" },
  { value: "font-lora", label: "Lora" },
  { value: "font-space", label: "Space Mono" },
] as const;

export type FontTheme = (typeof FONT_OPTIONS)[number]["value"];

const fontClassSet = new Set<string>(FONT_OPTIONS.map((option) => option.value));

export const isFontTheme = (value: string): value is FontTheme => fontClassSet.has(value);

export const getStoredFontTheme = (): FontTheme => {
  if (typeof window === "undefined") {
    return "font-inter";
  }

  const stored = window.localStorage.getItem(FONT_STORAGE_KEY);
  return stored && isFontTheme(stored) ? stored : "font-inter";
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
