import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerServiceWorker } from "./registerSW";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the PWA service worker with periodic update checks + auto-reload so
// installed PWAs pick up new builds without a manual reinstall.
registerServiceWorker();
