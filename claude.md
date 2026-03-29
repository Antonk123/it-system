# IT-Ticket — Developer Guide

## Project Overview

**IT-Ticket** är ett ärendehanteringssystem byggt för enskild användare (Anton) på Prefabmästarna. Systemet används för att:
- Skapa och hantera IT-ärenden
- Arkivera lösningar för framtida referens
- Skicka ut instruktioner och lösningar

Single-user system — ingen annan har tillgång.

## Tech Stack

| Lager | Teknologi |
|-------|-----------|
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Node.js, Express, TypeScript |
| Databas | SQLite |
| PWA | vite-plugin-pwa med Workbox |

## Infrastruktur & Hosting

- **Host**: Proxmox-server med Docker via Portainer
- **Git**: [GitHub — Antonk123/it-system](https://github.com/Antonk123/it-system)

### Miljöer

| Miljö | URL | Syfte |
|-------|-----|-------|
| **Prod** | `https://ticket.prefabmastarna.se` | Live-system |
| **Dev** | `http://10.38.195.180:5174/` | Testmiljö på servern |
| **Lokal** | `localhost` via `docker-compose.local.yml` | Lokal dev för att testa innan push |

### Portar

| Tjänst | Intern port | Extern port |
|--------|-------------|-------------|
| Backend (Express API) | 3001 | 3002 |
| Frontend (nginx/prod) | 80 | 8082 |
| Frontend (Vite/dev) | 8080 | — |

## Deployment

Flödet: lokal utveckling → git push → git pull på servern → Docker rebuild.

1. Gör ändringar lokalt (testa via `docker-compose.local.yml` vid behov)
2. `git push` till GitHub
3. På servern: `git pull`
4. Bygg Docker-images:
   - Backend: `docker build -t it-ticketing-backend:latest -f Dockerfile.server .`
   - Frontend: `docker build -t it-ticketing-frontend:latest -f Dockerfile.client .`
5. Starta om via Portainer eller `docker restart`

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items.
2. **Verify Plan**: Check in before starting implementation.
3. **Track Progress**: Mark items complete as you go.
4. **Explain Changes**: High-level summary at each step.
5. **Document Results**: Add review section to `tasks/todo.md`.
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections.

## Working Rules

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions).
- If something goes sideways, STOP and re-plan immediately — don't keep pushing.
- Use plan mode for verification steps, not just building.
- Write detailed specs upfront to reduce ambiguity.

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean.
- Offload research, exploration, and parallel analysis to subagents.
- For complex problems, throw more compute at it via subagents.
- One task per subagent for focused execution.

### 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern.
- Write rules for yourself that prevent the same mistake.
- Ruthlessly iterate on these lessons until mistake rate drops.
- Review lessons at session start for relevant project.

### 4. Verification Before Done

- Never mark a task complete without proving it works.
- Diff behavior between main and your changes when relevant.
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness.

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution."
- Skip this for simple, obvious fixes — don't over-engineer.
- Challenge your own work before presenting it.

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them.
- Zero context switching required from the user.
- Go fix failing CI tests without being told how.

## Frontend Aesthetics

<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics. You still tend to converge on common choices (Space Grotesk, for example) across generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>
