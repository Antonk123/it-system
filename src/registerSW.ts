import { toast } from 'sonner';

// Service worker registration with reliable auto-update.
//
// The default registration that vite-plugin-pwa injects only calls
// navigator.serviceWorker.register() — it never re-checks for a new version and
// never reloads the page. Combined with an installed PWA that stays open (iOS
// especially rarely navigates or closes), that meant a new build's service
// worker could activate in the background while the already-loaded tab kept
// running the OLD JavaScript bundle indefinitely — until the user manually
// uninstalled and reinstalled the PWA. (`injectRegister: false` in
// vite.config.ts disables the default injection so this is the sole registrar.)
//
// This registrar adds the two missing pieces:
//   1. Periodic update checks — hourly, plus whenever the app regains focus or
//      comes back online — so a suspended PWA picks up new builds on its own.
//   2. Auto-reload — when a new service worker takes control (our sw.ts calls
//      skipWaiting + clients.claim), reload once so the fresh bundle loads.
//      Guarded so the very first install (no previous controller) does not
//      trigger a spurious reload.
//   3. Deferred reload — if the user has unsaved work (e.g. an open ticket form),
//      the reload waits until they save/leave so an update never discards input.

// Module-level signals the UI mirrors its dirty state into (see TicketForm).
let unsavedRegistrations = 0;
let pendingReload = false;
let notifiedDeferred = false;

/** True medan något formulär/editor har osparat arbete. */
export function hasUnsavedWork(): boolean {
  return unsavedRegistrations > 0;
}

// Once work is saved/discarded, perform any reload that was deferred.
function flushDeferredReload(): void {
  if (!hasUnsavedWork() && pendingReload) {
    pendingReload = false;
    window.location.reload();
  }
}

/**
 * Registrerar osparat arbete och returnerar en funktion som avregistrerar det.
 * Flera editorer kan vara öppna samtidigt utan att den ena nollställer den
 * andras tillstånd. Anropa i en effekt och
 * returnera avregistreringen som cleanup medan editorn har osparad text.
 */
export function registerUnsavedWork(): () => void {
  unsavedRegistrations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    unsavedRegistrations -= 1;
    flushDeferredReload();
  };
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // Reload exactly once when control passes to a newly activated worker.
        // If the page was already controlled, a controllerchange means a genuine
        // update (not the first install), so it's safe to reload to the new code.
        const hadController = Boolean(navigator.serviceWorker.controller);
        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshing || !hadController) return;
          // Defer the reload while the user has unsaved work so a mid-edit update
          // never discards their input; it reloads as soon as the work clears.
          if (hasUnsavedWork()) {
            pendingReload = true;
            if (!notifiedDeferred) {
              notifiedDeferred = true;
              toast('En ny version finns — appen laddas om när du sparat.', { duration: 6000 });
            }
            return;
          }
          refreshing = true;
          window.location.reload();
        });

        const checkForUpdate = () => {
          // Skip while offline or mid-install to avoid noisy failures.
          if (!navigator.onLine || registration.installing) return;
          registration.update().catch(() => {});
        };

        // Hourly background check.
        window.setInterval(checkForUpdate, 60 * 60 * 1000);
        // Check when the user returns to the app (foregrounds the PWA) …
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') checkForUpdate();
        });
        // … and when connectivity is restored.
        window.addEventListener('online', checkForUpdate);
      })
      .catch(() => {
        // Registration failures are non-fatal — the app still works online.
      });
  });
}
