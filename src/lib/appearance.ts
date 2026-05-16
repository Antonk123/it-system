export const FONT_STORAGE_KEY = "app-font-theme";

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

// Light/Dark Mode utilities
export const MODE_STORAGE_KEY = "app-mode-theme";

export type ModeTheme = "light" | "dark";

export const getStoredMode = (): ModeTheme => {
  if (typeof window === "undefined") {
    return "light";
  }

  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
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
  window.localStorage.setItem(MODE_STORAGE_KEY, mode);
};

// Sidebar icon utilities
export const SIDEBAR_ICON_STORAGE_KEY = "app-sidebar-icon";

export const SIDEBAR_ICON_OPTIONS = [
  { value: "lifebuoy", label: "Livring (support)" },
  { value: "headset", label: "Headset (helpdesk)" },
  { value: "inbox", label: "Inkorg" },
  { value: "ticket", label: "Biljett (klassisk)" },
  { value: "wrench", label: "Skiftnyckel (IT)" },
  { value: "message-square", label: "Meddelande" },
  { value: "shield-check", label: "Sköld (säkerhet)" },
  { value: "sparkles", label: "Sparkles (modernt)" },
  { value: "zap", label: "Blixt (snabb)" },
  { value: "help-circle", label: "Frågetecken" },
] as const;

export type SidebarIcon = (typeof SIDEBAR_ICON_OPTIONS)[number]["value"];

const sidebarIconSet = new Set<string>(SIDEBAR_ICON_OPTIONS.map((o) => o.value));

export const isSidebarIcon = (value: string): value is SidebarIcon => sidebarIconSet.has(value);

export const DEFAULT_SIDEBAR_ICON: SidebarIcon = "lifebuoy";

export const getStoredSidebarIcon = (): SidebarIcon => {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_ICON;
  const stored = window.localStorage.getItem(SIDEBAR_ICON_STORAGE_KEY);
  return stored && isSidebarIcon(stored) ? stored : DEFAULT_SIDEBAR_ICON;
};

export const saveSidebarIcon = (icon: SidebarIcon) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SIDEBAR_ICON_STORAGE_KEY, icon);
};
