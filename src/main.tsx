import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { hasUnsavedWork, registerServiceWorker } from "./registerSW";
import { safeSessionStorage } from "./lib/safeStorage";

const PRELOAD_RELOAD_KEY = "chunk-reload-attempted";

// Efter en ny deploy finns gamla chunk-filer inte kvar, så en flik som körde den
// gamla versionen kan inte ladda sin nästa sida. En omladdning hämtar den nya
// versionen. Bara en gång per session (och aldrig över osparat arbete): faller
// den igen får felgränsen visa felet i stället för att vi loopar.
window.addEventListener("vite:preloadError", (event) => {
  if (hasUnsavedWork() || safeSessionStorage.getItem(PRELOAD_RELOAD_KEY)) return;
  safeSessionStorage.setItem(PRELOAD_RELOAD_KEY, "1");
  // Utan fungerande sessionStorage kan vi inte garantera "en gång" — ladda inte om.
  if (!safeSessionStorage.getItem(PRELOAD_RELOAD_KEY)) return;
  event.preventDefault();
  window.location.reload();
});

window.addEventListener("unhandledrejection", (event) => {
  if (import.meta.env.DEV) console.error("Unhandled promise rejection:", event.reason);
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the PWA service worker with periodic update checks + auto-reload so
// installed PWAs pick up new builds without a manual reinstall.
registerServiceWorker();

import "./prefabnavet-theme.css";
