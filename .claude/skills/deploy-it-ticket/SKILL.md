---
name: deploy-it-ticket
description: >-
  Deploy IT-Ticket to the server (build images via SSH; Anton redeploys in
  Portainer). Use ONLY when the user explicitly asks to deploy/ship/release or
  build server images. Encodes the exact runbook and the hard rule that Claude
  never runs container lifecycle commands.
disable-model-invocation: false
---

# Deploy runbook (IT-Ticket)

## Hard rules
- NEVER run `docker-compose up`, `docker run`, or any container lifecycle command.
  That spins up a SEPARATE stack that collides with the Portainer stack
  (prod id 39 `it-ticket-system`).
- Building images is allowed; STARTING/redeploying is Anton's manual step in
  Portainer GUI.

## Steps
1. Confirm local gates pass first: `npx eslint . --max-warnings 5`,
   frontend `npx tsc --noEmit -p tsconfig.app.json && -p tsconfig.node.json && npm test`,
   backend `cd server && npx tsc --noEmit && npm test`.
2. `git push` to GitHub (Antonk123/it-system).
3. Decide scope: did the change touch backend (server/**), frontend (src/**), or
   both? Build ONLY what changed.
4. SSH and pull (real host value lives in the gitignored `CLAUDE.local.md`):
   ```
   ssh <server>
   cd /opt/it-system/itticket-main && git pull
   ```
5. Build only needed images:
   - Backend: `docker build -t it-ticketing-backend:latest -f Dockerfile.server .`
   - Frontend: `docker build -t it-ticketing-frontend:latest -f Dockerfile.client .`
   (Dockerfile.client bakes VITE_API_URL at build time via ARG — it can't be set
   at runtime.)
6. Tell Anton to redeploy the stack in Portainer. Claude stops here.

## No server-side dev environment
The dev stack (id 40) was retired 2026-09-13 — rarely used, and its backend had
been dead ~9 days unnoticed. Verify changes locally BEFORE pushing: `npm run dev`
(Vite) plus `cd server && npm run dev` (tsx watch). Prod is the only stack now.

## Portainer divergence gotcha
The Portainer stack definition is a SEPARATE copy of the compose file, and
`git pull` on the server never updates it. This applies to the WHOLE file, not
just env vars: `command:`, `volumes:`, `ports:` and `image:` can all drift silently.
Anton must paste the repo version into the Portainer GUI and redeploy.

Two ways this has bitten:
- Missing env var — backend does an UNCONDITIONAL `process.exit(1)` without
  CSRF_SECRET/JWT_SECRET, so the container crash-loops.
- Stale `command:` — `--ignore-scripts` was committed to the dev compose file but
  never pasted into Portainer; that stack crash-looped 13 117 times over ~9 days.

Check what is ACTUALLY running before debugging:
`docker inspect <container> --format '{{json .Config.Cmd}}'`

See Obsidian Projekt/IT-System/lessons.md.
