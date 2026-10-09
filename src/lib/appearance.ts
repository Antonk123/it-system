import { safeStorage } from "@/lib/safeStorage";

const FONT_STORAGE_KEY = "app-font-theme";

export const FONT_OPTIONS = [
  { value: "font-jakarta", label: "Plus Jakarta Sans (standard)" },
  { value: "font-crimson", label: "Crimson Pro" },
  { value: "font-libre", label: "Libre Caslon" },
  { value: "font-jetbrains", label: "JetBrains Mono" },
  { value: "font-inter", label: "Inter" },
] as const;

export type FontTheme = (typeof FONT_OPTIONS)[number]["value"];

const fontClassSet = new Set<string>(FONT_OPTIONS.map((option) => option.value));

export const isFontTheme = (value: string): value is FontTheme => fontClassSet.has(value);

// Inter (standard) laddas av index.html. Övriga typsnitt hämtas först när de
// väljs, så att ingen besökare betalar för fyra typsnitt de aldrig använder.
const FONT_STYLESHEETS: Partial<Record<FontTheme, string>> = {
  "font-jakarta": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
  "font-crimson": "https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@400;500;600;700&display=swap",
  "font-libre": "https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:wght@400;700&display=swap",
  "font-jetbrains": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap",
};

const loadFontStylesheet = (fontTheme: FontTheme) => {
  const href = FONT_STYLESHEETS[fontTheme];
  if (!href || document.head.querySelector(`link[data-font-theme="${fontTheme}"]`)) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.fontTheme = fontTheme;
  document.head.appendChild(link);
};

export const getStoredFontTheme = (): FontTheme => {
  if (typeof window === "undefined") {
    return "font-inter";
  }

  const stored = safeStorage.getItem(FONT_STORAGE_KEY);
  return stored && isFontTheme(stored) ? stored : "font-inter";
};

export const applyFontTheme = (fontTheme: FontTheme) => {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.classList.remove(...FONT_OPTIONS.map((option) => option.value));
  document.documentElement.classList.add(fontTheme);
  loadFontStylesheet(fontTheme);
};

export const saveFontTheme = (fontTheme: FontTheme) => {
  if (typeof window === "undefined") {
    return;
  }
  safeStorage.setItem(FONT_STORAGE_KEY, fontTheme);
};

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
