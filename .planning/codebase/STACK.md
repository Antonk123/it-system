# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**
- TypeScript 5.8.3 - Frontend and server code
- JavaScript (ESNext) - Build configuration and scripts

**Secondary:**
- SQL - SQLite database queries via better-sqlite3

## Runtime

**Environment:**
- Node.js 20 (Alpine) - Specified in `Dockerfile.server` and `Dockerfile.client`

**Package Manager:**
- npm (v10 or later implied by Node 20)
- Lockfile: `package-lock.json` present in root and `server/` directory

## Frameworks

**Frontend:**
- React 18.3.1 - UI component library
- React Router 7.12.0 - Client-side routing (`src/lib/api.ts`, route setup)
- Vite 7.3.1 - Build tool and dev server
- Tailwind CSS 3.4.17 - Utility-first CSS
- shadcn-ui (via Radix UI components) - Accessible component library

**Backend:**
- Express 4.21.2 - HTTP server and routing (`server/src/index.ts`)
- Passport 0.7.0 - Authentication middleware (local + JWT strategies)
- better-sqlite3 11.7.0 - Synchronous SQLite driver

**Testing:**
- Not detected

**Build/Dev:**
- Vite with React SWC plugin - Fast build and HMR
- Vite PWA plugin 0.20.5 - Progressive Web App support
- TypeScript compiler - Type checking
- ESLint 10.0.1 - Code linting
- Tailwind CSS with autoprefixer - CSS processing
- Lovable tagger plugin - Component tagging in development

## Key Dependencies

**Critical (Frontend):**
- `@supabase/supabase-js` 2.89.0 - Optional Supabase auth integration
- `@tanstack/react-query` 5.83.0 - Server state management
- `@tiptap/react` 3.20.0 - Rich text editor
- `framer-motion` 12.38.0 - Animation library
- `react-hook-form` 7.61.1 - Form state management
- `zod` 3.25.76 - Schema validation
- `axios` 1.13.6 - HTTP client (though primarily uses fetch)

**Critical (Backend):**
- `express` 4.21.2 - Web framework
- `better-sqlite3` 11.7.0 - Database driver
- `bcryptjs` 2.4.3 - Password hashing
- `jsonwebtoken` 9.0.2 - JWT creation and verification
- `passport` 0.7.0 - Authentication strategies
- `nodemailer` 6.10.0 - Email sending (SMTP)
- `node-cron` 3.0.3 - Scheduled task execution
- `multer` 1.4.5-lts.1 - File upload handling
- `helmet` 8.1.0 - Security headers
- `csrf-csrf` 4.0.3 - CSRF protection
- `express-rate-limit` 7.4.1 - Rate limiting
- `uuid` 11.0.5 - UUID generation

**UI Components:**
- `@radix-ui/*` - 15+ component primitives (accordion, dialog, dropdown, etc.)
- `lucide-react` 0.462.0 - Icon library
- `sonner` 1.7.4 - Toast notifications
- `vaul` 0.9.9 - Drawer component
- `embla-carousel-react` 8.6.0 - Carousel component
- `react-resizable-panels` 2.1.9 - Resizable panel layout

**Content/Formatting:**
- `@tiptap/starter-kit` 3.20.0 - Complete rich text editor
- `react-markdown` 10.1.0 - Markdown rendering
- `rehype-sanitize` 6.0.0 - HTML sanitization
- `dompurify` 3.3.1 - XSS prevention
- `turndown` 7.2.2 - HTML to Markdown conversion
- `date-fns` 3.6.0 - Date utilities
- `recharts` 2.15.4 - Chart library

**Drag & Drop:**
- `@dnd-kit/*` - Drag-and-drop functionality (core, sortable, utilities)

**Styling:**
- `class-variance-authority` 0.7.1 - Component variant helpers
- `clsx` 2.1.1 - Conditional classname helper
- `tailwind-merge` 2.6.0 - Tailwind CSS class merging
- `next-themes` 0.3.0 - Dark mode theme management

## Configuration

**Frontend Environment:**
- `VITE_SUPABASE_URL` - Optional: Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` - Optional: Supabase public API key
- `VITE_API_URL` - Optional: Backend API base URL (defaults to `/api`)

**Backend Environment:**
- `JWT_SECRET` - REQUIRED: Secret for signing JWT tokens
- `NODE_ENV` - Environment (development/production)
- `DB_PATH` - SQLite database file path (default: `/app/data/database.sqlite`)
- `UPLOAD_DIR` - File upload directory (default: `/app/data/uploads`)
- `CORS_ORIGIN` - Comma-separated allowed CORS origins
- `APP_BASE_URL` - Application base URL (for email links)
- `PORT` - Express server port (default: 3001)
- `SMTP_HOST` - SMTP server hostname (optional: enables email/reminders)
- `SMTP_PORT` - SMTP port (default: 587)
- `SMTP_USER` - SMTP authentication username
- `SMTP_PASS` - SMTP authentication password
- `EMAIL_FROM` - Sender email address (required if SMTP_HOST set)
- `EMAIL_TO` - Recipient email address for notifications (required if SMTP_HOST set)

**Build:**
- `Dockerfile.client` - Multi-stage build: Node 20 Alpine → nginx Alpine
- `Dockerfile.server` - Node 20 Alpine with tsx runtime
- `vite.config.ts` - Vite configuration with API proxy, PWA, and component tagging
- `tsconfig.json` - Root TypeScript config (references app and node configs)
- `tsconfig.app.json` - Frontend TypeScript (ES2020, bundler module resolution)
- `server/tsconfig.json` - Backend TypeScript (ES2022, strict mode)
- `tailwind.config.ts` - Tailwind CSS with dark mode and extended colors
- `eslint.config.js` - ESLint configuration
- `postcss.config.js` - PostCSS configuration
- `nginx.conf` - Nginx reverse proxy configuration

## Platform Requirements

**Development:**
- Docker and Docker Compose (local development via `docker-compose.local.yml`)
- Node 20+ (for local development outside Docker)
- npm 10+ (for dependency management)

**Production:**
- Docker runtime
- Docker Compose (for orchestration)
- Nginx reverse proxy (handles /api proxying and static file serving)
- Persistent volume for SQLite database and file uploads

## Container Architecture

**Frontend Container:**
- Base: nginx:alpine
- Build stage: Node 20-alpine (compiles TypeScript and Vite bundle)
- Serves SPA on port 80
- Nginx reverse proxy at `/api/` routes to backend service
- Workbox service worker for offline support and API caching

**Backend Container:**
- Base: Node 20-alpine
- Runs tsx directly (TypeScript runtime, no compilation step)
- Listens on port 3001
- Mounts volume at `/app/data` for SQLite and file uploads
- Automatic restart unless explicitly stopped

**Network:**
- Docker bridge network named `ticketing` connects frontend and backend
- Frontend accesses backend via `http://it-ticketing-backend:3001` (internal DNS)

---

*Stack analysis: 2026-03-22*
