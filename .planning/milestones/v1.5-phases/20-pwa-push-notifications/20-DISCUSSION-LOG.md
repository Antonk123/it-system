# Phase 20: PWA Push Notifications - Discussion Log (Assumptions Mode)

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in CONTEXT.md — this log preserves the analysis.

**Date:** 2026-04-05
**Phase:** 20-pwa-push-notifications
**Mode:** assumptions (--auto)
**Areas analyzed:** Service Worker Strategy, Backend Push Infrastructure, Scheduler Integration, Settings UI, CSP & Nginx

## Assumptions Presented

### Service Worker Strategy
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Switch from generateSW to injectManifest with custom src/sw.ts | Confident | vite.config.ts lines 22-69, no custom SW exists |
| Install workbox-precaching, add WebWorker to tsconfig lib | Confident | Required for injectManifest compilation |
| Config: strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts' | Confident | vite-plugin-pwa docs confirm this shape |

### Backend Push Infrastructure
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Install web-push + @types/web-push, works with ESM via esModuleInterop | Confident | npm registry, CJS library with TS types available |
| New push_subscriptions table with endpoint, p256dh, auth | Confident | No existing push infrastructure in schema.sql |
| VAPID keys in .env with startup guard | Confident | STATE.md research flag, standard web-push pattern |

### Scheduler Integration
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Add push to reminderScheduler.ts alongside email, decouple from SMTP guard | Likely | reminderScheduler.ts gated on SMTP config |
| Daily aging ticket check querying updated_at > N days | Likely | autoCloseScheduler.ts pattern for aging queries |

### Settings UI
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Toggle in Settings with permission state display | Confident | PUSH-01 requirement, Settings.tsx has section pattern |
| Permission prompt only on explicit user action | Confident | STATE.md research flag |

### CSP & Nginx
| Assumption | Confidence | Evidence |
|------------|-----------|----------|
| Update Helmet connectSrc for push service endpoints | Likely | server/src/index.ts Helmet CSP, connectSrc: ['self'] |
| Add no-cache headers for /sw.js in nginx.conf | Likely | nginx.conf immutable cache on .js, SW uses fixed filename |

## Corrections Made

No corrections — all assumptions confirmed (--auto mode).

## Auto-Resolved

- Scheduler Integration (Likely): auto-selected "Add push inside existing reminderScheduler.ts"
- CSP & Nginx (Likely): auto-selected "Update Helmet connectSrc + nginx no-cache for sw.js"

## External Research

- vite-plugin-pwa injectManifest config: Confirmed `strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts'` with `precacheAndRoute(self.__WB_MANIFEST)` (Source: vite-pwa-org.netlify.app)
- web-push ESM compatibility: CJS library, works via esModuleInterop. Types at @types/web-push (Source: npmjs.com/package/web-push)
- nginx SW caching: SW file is fixed `/sw.js` (not hashed), must set no-cache headers (Source: web dev best practices)
