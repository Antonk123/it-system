import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';
import { logger } from '../lib/logger.js';
import { validateSecret } from './secretValidation.js';
import { BCRYPT_ROUNDS } from '../lib/passwordPolicy.js';

// CRITICAL: JWT_SECRET must be set in environment variables
// Never use a hardcoded fallback in production.
// Validation logic lives in secretValidation.ts (pure, unit-tested) — this IIFE
// just wires the result to logging + process.exit for this specific secret.
const JWT_SECRET: string = (() => {
  const secret = process.env.JWT_SECRET;
  const result = validateSecret('JWT_SECRET', secret, process.env);
  if (!result.ok) {
    logger.error(`FATAL: ${result.reason}`);
    logger.error('Generate one with: openssl rand -base64 32');
    process.exit(1);
  }
  if (result.warning) {
    logger.warn(result.warning);
  }
  return secret as string;
})();

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login: string | null;
  must_change_password: number;
  token_version: number;
}

// Jämförs mot när e-posten saknas, så svarstiden inte avslöjar om kontot finns.
const DUMMY_PASSWORD_HASH = '$2b$12$cFBeDiwTqF0dDKRWu0X8B.DDBSp/EY4jlWkSjQL/L52Zjvx/em6Py';

// Local strategy for username/password login
passport.use(new LocalStrategy(
  {
    usernameField: 'email',
    passwordField: 'password',
  },
  async (email, password, done) => {
    try {
      // Only select columns needed for authentication (not all columns)
      const user = typeof email === 'string'
        ? db.prepare(
            'SELECT id, email, password_hash, role, must_change_password, token_version FROM users WHERE LOWER(email) = LOWER(?)'
          ).get(email) as UserRow | undefined
        : undefined;

      const isMatch = await bcrypt.compare(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);

      if (!user || !isMatch) {
        return done(null, false, { message: 'Incorrect email or password.' });
      }

      // Höj kostnaden för äldre hashar (cost 10) i takt med att användarna loggar in.
      if (bcrypt.getRounds(user.password_hash) < BCRYPT_ROUNDS) {
        try {
          const upgraded = await bcrypt.hash(password, BCRYPT_ROUNDS);
          db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(upgraded, user.id);
        } catch (rehashError) {
          logger.warn('Password rehash failed (non-fatal)', { error: String(rehashError) });
        }
      }

      // Update last login
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

      return done(null, {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.must_change_password === 1,
        tokenVersion: user.token_version,
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
      const user = db.prepare('SELECT id, email, role, token_version FROM users WHERE id = ?').get(payload.sub) as UserRow | undefined;

      // `tv` höjs vid lösenordsbyte/-återställning: äldre access-tokens dör direkt
      // i stället för att leva kvar upp till 15 minuter. Token utan `tv` räknas som 0.
      if (!user || (typeof payload.tv === 'number' ? payload.tv : 0) < user.token_version) {
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
