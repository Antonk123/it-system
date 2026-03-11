import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initializeDatabase } from './db/connection.js';
import { startReminderScheduler } from './lib/reminderScheduler.js';
import passport from './config/passport.js';

// Import routes
import authRoutes from './routes/auth.js';
import ticketRoutes from './routes/tickets.js';
import categoryRoutes from './routes/categories.js';
import contactRoutes from './routes/contacts.js';
import attachmentRoutes from './routes/attachments.js';
import checklistRoutes from './routes/checklists.js';
import commentsRoutes from './routes/comments.js';
import linkRoutes from './routes/links.js';
import shareRoutes from './routes/shares.js';
import userRoutes from './routes/users.js';
import publicRoutes from './routes/public.js';
import templateRoutes from './routes/templates.js';
import tagRoutes from './routes/tags.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy - CRITICAL for correct IP detection behind nginx reverse proxy
// Without this, req.ip will be the proxy's IP, not the client's IP
// This affects rate limiting and logging
app.set('trust proxy', true);

// Initialize database
initializeDatabase();

// Start reminder scheduler
startReminderScheduler();

// Security headers with Helmet
// Protects against common web vulnerabilities
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for React apps
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
}));

// Middleware
// CORS configuration - NEVER use '*' with credentials
// Merge environment CORS_ORIGIN with localhost defaults for maximum flexibility
const envOrigins = process.env.CORS_ORIGIN?.split(',').filter(Boolean) || [];
const defaultOrigins = [
  'http://localhost:5173',          // Vite dev server (local)
  'http://localhost:8082',          // Docker frontend (local)
];
// Use Set to deduplicate in case of overlaps
const allowedOrigins = [...new Set([...envOrigins, ...defaultOrigins])];

// Log CORS configuration at startup for debugging
console.log('🔒 CORS Configuration:');
console.log('  Environment CORS_ORIGIN:', process.env.CORS_ORIGIN || '(not set - using defaults)');
console.log('  Allowed Origins:', allowedOrigins.join(', '));

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`❌ CORS blocked: Origin '${origin}' not in allowed list.`);
      console.error(`   Allowed origins: ${allowedOrigins.join(', ')}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(express.json());
app.use(passport.initialize());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/checklists', checklistRoutes);
app.use('/api/comments', commentsRoutes);
app.use('/api/links', linkRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/users', userRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/tags', tagRoutes);

// Error handling
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
});
