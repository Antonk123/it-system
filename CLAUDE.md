# IT Ticket System — Developer Guide

## 📋 Project Overview

**Name:** IT Ticket System (it-ticketing)
**Purpose:** IT issue ticketing & asset management system
**Type:** Full-stack web application
**Scope:** Single-user (personal IT management)
**Status:** Active development

## 🏗️ Architecture

### High-Level Structure
```
it-ticketing/
├── Frontend (React)          # src/
├── Backend (Node/Express)    # server/src/
├── Docker configs
├── Docker Compose setup
└── Automated setup.sh
```

### Tech Stack

**Frontend:**
- React 18+ (TypeScript)
- Vite (bundler)
- Tailwind CSS (styling)
- shadcn-ui (component library)
- React Router (routing)
- TanStack Query (data fetching)
- Zustand (state management)

**Backend:**
- Node.js (TypeScript)
- Express.js
- SQLite (database)
- Passport.js (authentication)
- Multer (file uploads)

**DevOps:**
- Docker & Docker Compose
- Nginx (reverse proxy)

**Package Managers:**
- npm (both frontend and backend)

## 📂 Project Structure

### Frontend (`src/`)
```
src/
├── pages/              # Route pages
│   ├── Dashboard.tsx   # Main overview
│   ├── TicketList.tsx  # Ticket browse/filter
│   ├── TicketDetail.tsx # Single ticket view
│   ├── TicketForm.tsx  # Create/edit ticket
│   ├── Archive.tsx     # Closed tickets
│   ├── Reports.tsx     # Analytics & reports
│   ├── UserList.tsx    # User management
│   ├── Settings.tsx    # System settings
│   └── [Auth pages]
├── components/         # Reusable React components
│   ├── ui/            # shadcn-ui components
│   ├── Ticket*.tsx    # Ticket-related components
│   ├── DynamicField.tsx # Custom field renderer
│   └── [Others]
├── hooks/             # Custom React hooks
│   ├── useTickets.ts
│   ├── useUsers.ts
│   ├── useTemplates.ts
│   └── [Others]
├── contexts/          # React Context (auth, theme)
├── lib/              # Utility functions
│   ├── api.ts        # API client wrapper
│   ├── utils.ts      # Helper functions
│   └── validations.ts # Input validation
├── types/            # TypeScript types
├── integrations/     # External service integrations
└── main.tsx          # Entry point
```

### Backend (`server/src/`)
```
server/src/
├── db/                 # Database layer
│   ├── schema.sql     # Database schema
│   ├── init.ts        # Initialize DB
│   ├── connection.ts  # DB connection pool
│   └── [migration scripts]
├── routes/            # API endpoints
│   ├── tickets.ts
│   ├── users.ts
│   ├── categories.ts
│   ├── contacts.ts
│   ├── attachments.ts
│   ├── comments.ts
│   ├── links.ts
│   ├── shares.ts
│   ├── templates.ts
│   └── [Others]
├── middleware/        # Express middleware
│   ├── auth.ts       # Authentication
│   └── [Others]
├── lib/              # Utilities
│   └── email.ts      # Email sending
├── config/           # Configuration
│   └── passport.ts   # Auth strategy
├── types/            # TypeScript types
└── index.ts          # Server entry point
```

## 🗄️ Database Schema

### Key Tables

**users** - System users with login
- id, email, display_name, password_hash, role (admin|user)

**contacts** - External ticket requesters (no login)
- id, name, email, phone, company

**categories** - Ticket categories
- id, name, label

**tickets** - The main ticket records
- id, title, description, status, priority, category_id
- requester_id, notes, solution
- Statuses: open, in-progress, waiting, resolved, closed
- Priorities: low, medium, high, critical

**ticket_attachments** - File uploads linked to tickets
- id, ticket_id, file_name, file_path, file_size

**ticket_checklists** - Task lists within tickets
- id, ticket_id, label, completed

**ticket_comments** - Internal notes & discussions
- id, ticket_id, user_id, content, is_internal

**ticket_shares** - Public share tokens for external access
- id, ticket_id, share_token

**ticket_links** - Relationships between tickets
- id, source_ticket_id, target_ticket_id, link_type

### Database Indexes
- Status, priority, category, requester indexed for fast queries
- Unique index on ticket links to prevent duplicates

## 🚀 Installation & Deployment

### Quick Start (Automated)
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Antonk123/it-system/main/setup.sh)
```

The setup.sh script:
1. Validates Docker/Docker Compose/git
2. Clones repository
3. **Removes GitHub remote** (system stays local)
4. Prompts for configuration (ports, SMTP)
5. Builds Docker images
6. Creates Docker volume
7. Starts containers
8. Initializes database

### Manual Setup

**Prerequisites:**
- Docker & Docker Compose v2
- Git, curl, openssl

**Steps:**
```bash
git clone https://github.com/Antonk123/it-system.git
cd it-system
git remote remove origin  # Important! Keep system local

# Create .env file with your config
cat > .env << EOF
FRONTEND_PORT=8082
BACKEND_PORT=3002
CORS_ORIGIN=http://localhost:8082
APP_BASE_URL=http://localhost:8082
JWT_SECRET=$(openssl rand -base64 32)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=
EMAIL_TO=
VITE_SUPABASE_URL=http://localhost
VITE_SUPABASE_PUBLISHABLE_KEY=placeholder
EOF

# Build and start
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
docker build -f Dockerfile.client -t it-ticketing-frontend:latest .
docker compose -f docker-compose.local.yml up -d
```

## 📝 Development Workflow

### Two Environments

Det finns två separata miljöer som kan köras samtidigt:

| Miljö | Compose-fil | Frontend | Backend | Syfte |
|-------|-------------|----------|---------|-------|
| **Dev (sandbox)** | `docker-compose.dev.portainer.yml` | `:5174` | `:3003` | Hot-reload, aktiv utveckling |
| **Prod** | `docker-compose.local.yml` | `:8082` | `:3002` | Stabil, byggda images |

De kör parallellt utan konflikt tack vare `name: it-ticketing-dev` i dev-filen.

---

### Dev-miljö (Hot-reload) — Rekommenderat för utveckling

Dev-miljön använder **volume mounts** — källkoden på Mac monteras direkt in i containrarna. Inga image-rebuilds behövs; ändringar syns automatiskt via HMR.

```bash
# Starta dev-miljön
docker compose -f docker-compose.dev.portainer.yml up -d

# Frontend: http://10.10.10.18:5174  (Vite HMR, ~1s per ändring)
# Backend:  http://10.10.10.18:3003  (tsx watch, ~3s per ändring)
```

**Workflow:**
1. Redigera kod på Mac (i `/Volumes/it-ticketing/`)
2. Frontend-ändringar syns i ~1s via Vite HMR
3. Backend-ändringar syns i ~3s via tsx watch
4. Testa på `:5174`
5. När nöjd → bygg prod-images och deploya till `:8082`

**Loggar dev:**
```bash
docker compose -f docker-compose.dev.portainer.yml logs -f
docker compose -f docker-compose.dev.portainer.yml logs -f backend-dev
docker compose -f docker-compose.dev.portainer.yml logs -f frontend-dev
```

**Stoppa dev:**
```bash
docker compose -f docker-compose.dev.portainer.yml down
```

> **OBS:** Dev-miljön delar databasen (`it-ticketing-data` volume) med prod. Ändringar i data syns i båda miljöerna.

---

### Prod-miljö — Stabil, byggda images

Prod använder färdigbyggda Docker-images. Kräver rebuild vid kodändringar.

**Starta/stoppa:**
```bash
docker compose -f docker-compose.local.yml up -d
docker compose -f docker-compose.local.yml down
```

**Rebuild images efter kodändringar:**
```bash
# Backend only
docker build -f Dockerfile.server -t it-ticketing-backend:latest .

# Frontend only
docker build -f Dockerfile.client -t it-ticketing-frontend:latest .

# Båda + restart
docker build -f Dockerfile.server -t it-ticketing-backend:latest . && \
docker build -f Dockerfile.client -t it-ticketing-frontend:latest . && \
docker compose -f docker-compose.local.yml up -d --force-recreate
```

**Loggar prod:**
```bash
docker compose -f docker-compose.local.yml logs -f
docker compose -f docker-compose.local.yml logs -f backend
docker compose -f docker-compose.local.yml logs -f frontend
```

---

### Lokal utveckling utan Docker (alternativ)

```bash
# Frontend
npm install --legacy-peer-deps
npm run dev  # port 5173

# Backend
cd server
npm install
npm run dev  # port 3002
```

> **OBS:** Kräver `--legacy-peer-deps` p.g.a. konflikt mellan eslint@10 och eslint-plugin-react-hooks.

## 🔧 Database Management

### Initialize Database
```bash
# In running container
docker exec it-ticketing-backend npm run init-db

# Or locally (if backend running on localhost:3002)
npm run init-db
```

### Database Schema Updates

1. **Modify schema:**
   Edit `server/src/db/schema.sql`

2. **Create migration script:**
   Create new file: `server/src/db/migrate-to-v2.ts` (or similar)

3. **Example migration:**
   ```typescript
   import { getDatabase } from './connection';

   export async function migrate() {
     const db = getDatabase();
     await db.exec(`
       ALTER TABLE assets ADD COLUMN warranty_until TEXT;
     `);
     console.log('Migration complete');
   }
   ```

4. **Run migration:**
   - Add to backend start sequence, OR
   - Run manually: `docker exec it-ticketing-backend npx ts-node src/db/migrate-to-v2.ts`

## 🔑 Environment Variables

### Frontend (.env)
```
VITE_SUPABASE_URL=http://localhost
VITE_SUPABASE_PUBLISHABLE_KEY=placeholder
```

### Backend (.env)
```
FRONTEND_PORT=8082
BACKEND_PORT=3002
CORS_ORIGIN=http://localhost:8082
APP_BASE_URL=http://localhost:8082
JWT_SECRET=<generated-secret>
NODE_ENV=development|production
DB_PATH=/app/data/database.sqlite
UPLOAD_DIR=/app/data/uploads
SMTP_HOST=<mail-server>
SMTP_PORT=587
SMTP_USER=<email>
SMTP_PASS=<password>
EMAIL_FROM=noreply@company.com
EMAIL_TO=admin@company.com
```

## 🔐 Authentication & Authorization

**Method:** JWT (JSON Web Tokens)

**Flow:**
1. User logs in with email/password
2. Backend validates credentials
3. Server returns JWT token
4. Frontend stores token (localStorage/sessionStorage)
5. Token sent in Authorization header for protected routes

**Roles:**
- `admin` - Full system access, can manage users & system settings
- `user` - Can create & manage tickets, limited to their own data

**Relevant files:**
- `server/src/config/passport.ts` - Passport.js strategy
- `server/src/middleware/auth.ts` - Auth middleware
- `src/contexts/AuthContext.tsx` - Frontend auth state

## 📤 File Uploads & Storage

**Location:** `/app/data/uploads/` (Docker volume)
**Max size:** Configurable via backend
**Formats:** Any (security: validate MIME type on backend)

**Relevant files:**
- `server/src/routes/attachments.ts` - Upload handling
- `src/components/FileUpload.tsx` - Frontend upload UI
- `src/lib/secureFileAccess.ts` - Secure file access

## 🐛 Common Debugging

### Container won't start
```bash
# Check logs
docker compose -f docker-compose.local.yml logs backend
docker compose -f docker-compose.local.yml logs frontend

# Rebuild images
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
docker build -f Dockerfile.client -t it-ticketing-frontend:latest .
```

### Database locked errors
SQLite has poor concurrent write support. If many users access simultaneously:
- Upgrade to PostgreSQL (recommended for production)
- Or implement connection pooling better
- Or add queue system for writes

### Port already in use
```bash
# Find and kill process on port 8082
lsof -i :8082
kill -9 <PID>
```

### Hot reload not working (dev-miljön)
```bash
# Kontrollera att dev-containrarna kör
docker compose -f docker-compose.dev.portainer.yml ps

# Starta om dev-miljön
docker compose -f docker-compose.dev.portainer.yml down
docker compose -f docker-compose.dev.portainer.yml up -d

# Kolla loggar för fel
docker compose -f docker-compose.dev.portainer.yml logs frontend-dev
docker compose -f docker-compose.dev.portainer.yml logs backend-dev
```

> Kom ihåg: Hot-reload fungerar bara i dev-miljön (`:5174`/`:3003`). Prod (`:8082`) kräver image-rebuild.

## 📦 Production Deployment Considerations

**Before going production:**
- [ ] Switch from SQLite to PostgreSQL
- [ ] Set up proper SMTP for email notifications
- [ ] Enable HTTPS (reverse proxy with SSL)
- [ ] Configure backups for database
- [ ] Set up log aggregation
- [ ] Enable authentication (currently basic JWT)
- [ ] Add rate limiting on API
- [ ] Set up monitoring/alerting

**Deployment options:**
- Docker Compose on single server
- Kubernetes (use Helm chart)
- Cloud platforms (AWS ECS, Azure Container Instances, etc)

## 🔄 Git & Version Control

**IMPORTANT:** This system is configured to work **locally only** (GitHub remote removed by setup.sh).

If you want to sync to GitHub later:
```bash
git remote add origin https://github.com/YOUR-USER/it-system.git
git push -u origin main
```

## 📞 API Endpoints

Key endpoints (see `server/src/routes/` for full list):

**Tickets:**
- `GET /api/tickets` - List tickets
- `POST /api/tickets` - Create ticket
- `GET /api/tickets/:id` - Get ticket details
- `PUT /api/tickets/:id` - Update ticket
- `DELETE /api/tickets/:id` - Delete ticket

**Users:**
- `GET /api/users` - List users
- `POST /api/users` - Create user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

**Categories:**
- `GET /api/categories` - List categories
- `POST /api/categories` - Create category
- `PUT /api/categories/:id` - Update category

See backend routes for complete list.

## 📚 Code Conventions

**Naming:**
- Components: PascalCase (`TicketCard.tsx`)
- Functions/variables: camelCase (`fetchTickets`)
- Database columns: snake_case (`created_at`)

**File Structure:**
- Keep components small and focused
- Extract logic to hooks (`use*.ts`)
- Group related utilities in `/lib`

**TypeScript:**
- Use interfaces for objects
- Define types in `/src/types` and `/server/src/types`
- Avoid `any` type

**Git Commits:**
- Use clear, descriptive messages
- Example: "Add asset tracking to tickets"
- Reference TODO.md for planned work

---

## Quick Reference

### Dev-miljö (hot-reload, port :5174/:3003)
| Task | Command |
|------|---------|
| Starta dev | `docker compose -f docker-compose.dev.portainer.yml up -d` |
| Stoppa dev | `docker compose -f docker-compose.dev.portainer.yml down` |
| Loggar dev | `docker compose -f docker-compose.dev.portainer.yml logs -f` |
| SSH backend-dev | `docker exec -it it-ticketing-dev-backend sh` |

### Prod-miljö (byggda images, port :8082/:3002)
| Task | Command |
|------|---------|
| Starta prod | `docker compose -f docker-compose.local.yml up -d` |
| Stoppa prod | `docker compose -f docker-compose.local.yml down` |
| Loggar prod | `docker compose -f docker-compose.local.yml logs -f` |
| SSH backend-prod | `docker exec -it it-ticketing-backend sh` |
| Rebuild backend | `docker build -f Dockerfile.server -t it-ticketing-backend:latest .` |
| Rebuild frontend | `docker build -f Dockerfile.client -t it-ticketing-frontend:latest .` |
| Rebuild båda | `docker build -f Dockerfile.server -t it-ticketing-backend:latest . && docker build -f Dockerfile.client -t it-ticketing-frontend:latest .` |

### Databas
| Task | Command |
|------|---------|
| Init DB (prod) | `docker exec it-ticketing-backend npm run init-db` |
| Init DB (dev) | `docker exec it-ticketing-dev-backend npm run init-db` |

### Övrigt
| Task | Command |
|------|---------|
| Build frontend | `npm run build` |
| Build backend | `cd server && npm run build` |
| Check git remotes | `git remote -v` (ska vara tomt) |

---

**Last Updated:** 2026-02-23
**Version:** Early Development
