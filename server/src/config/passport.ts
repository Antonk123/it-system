import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';
import { logger } from '../lib/logger.js';

// CRITICAL: JWT_SECRET must be set in environment variables
// Never use a hardcoded fallback in production
const MIN_SECRET_LENGTH = 32;
const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('FATAL: JWT_SECRET environment variable is not set!');
    logger.error('Please set JWT_SECRET to a strong random value.');
    logger.error('Generate one with: openssl rand -base64 32');
    process.exit(1);
  }
  // A short secret is brute-forceable (HS256 token forging). Fail CLOSED by
  // default. The relaxation requires TWO explicit conditions — opt-in flag AND a
  // whitelisted non-prod NODE_ENV ('development'|'test', never "!= production") —
  // so neither a misconfigured prod with NODE_ENV unset, nor ALLOW_WEAK_SECRETS=1
  // leaking into prod, can fail open. (Missing secret above always exits too.)
  if (secret.length < MIN_SECRET_LENGTH) {
    const allowWeak =
      process.env.ALLOW_WEAK_SECRETS === '1' &&
      (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test');
    if (allowWeak) {
      logger.warn(
        `JWT_SECRET is short (${secret.length} chars) — allowed only because ALLOW_WEAK_SECRETS=1 in NODE_ENV=${process.env.NODE_ENV}. Recommend at least ${MIN_SECRET_LENGTH}.`
      );
    } else {
      logger.error(
        `FATAL: JWT_SECRET is too short (${secret.length} chars) — must be at least ${MIN_SECRET_LENGTH}. (Overridable only with NODE_ENV=development|test + ALLOW_WEAK_SECRETS=1.) Generate with: openssl rand -base64 32`
      );
      process.exit(1);
    }
  }
  return secret;
})();

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login: string | null;
}

// Local strategy for username/password login
passport.use(new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password',
  },
  async (email, password, done) => {
    try {
      // Only select columns needed for authentication (not all columns)
      const user = db.prepare('SELECT id, email, password_hash, role FROM users WHERE email = ?').get(email) as UserRow | undefined;

      if (!user) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }

      // Update last login
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

      return done(null, {
        id: user.id,
        email: user.email,
        role: user.role,
      });
    } catch (error) {
      return done(error);
    }
  }
));

// JWT strategy for protected routes
passport.use(new JwtStrategy(
  {
    // Only accept JWT from Authorization header (not from URL query parameters)
    // Query parameters are logged in browser history, server logs, and proxies
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: JWT_SECRET,
    algorithms: ['HS256'] as const,
  },
  (payload, done) => {
    try {
      const user = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(payload.sub) as UserRow | undefined;

      if (!user) {
        return done(null, false);
      }

      return done(null, {
        id: user.id,
        email: user.email,
        role: user.role,
      });
    } catch (error) {
      return done(error, false);
    }
  }
));

export { JWT_SECRET };
export default passport;
