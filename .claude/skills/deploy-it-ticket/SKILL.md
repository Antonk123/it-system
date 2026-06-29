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
  That spins up a SEPARATE stack that collides with the Portainer stacks
  (prod id 39 `it-ticket-system`, dev id 40 `it-system-dev`).
- Building images is allowed; STARTING/redeploying is Anton's manual step in
  Portainer GUI.

## Steps
1. Confirm local gates pass first: `npx eslint . --max-warnings 5`,
   frontend `npx tsc --noEmit -p tsconfig.app.json && -p tsconfig.node.json && npm test`,
   backend `cd server && npx tsc --noEmit && npm test`.
2. `git push` to GitHub (Antonk123/it-system).
3. Decide scope: did the change touch backend (server/**), frontend (src/**), or
   both? Build ONLY what changed.
4. SSH and pull:
   ```
   ssh root@10.38.195.180
   cd /opt/it-system/itticket-main && git pull
   ```
5. Build only needed images:
   - Backend: `docker build -t it-ticketing-backend:latest -f Dockerfile.server .`
   - Frontend: `docker build -t it-ticketing-frontend:latest -f Dockerfile.client .`
   (Dockerfile.client bakes VITE_API_URL at build time via ARG — it can't be set
   at runtime.)
6. Tell Anton to redeploy the stack in Portainer. Claude stops here.

## Dev environment (faster path, no image rebuild)
Dev stack (id 40) shares the prod checkout `/opt/it-system/itticket-main` on main
but has its own DB volume. To refresh dev to latest main:
`git -C /opt/it-system/itticket-main pull --ff-only` — tsx watch + Vite hot-reload,
no rebuild. Prod sees nothing until a new image is built and redeployed.

## Portainer env gotcha
The Portainer stack file is SEPARATE from the repo compose files. New env vars
(e.g. CSRF_SECRET — backend does an UNCONDITIONAL process.exit(1) without it,
even in dev) must be added MANUALLY in the Portainer GUI before redeploy, or the
container crash-loops. See Obsidian Projekt/IT-System/lessons.md.
