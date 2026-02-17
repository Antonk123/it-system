import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import bcrypt from 'bcryptjs';
import { db } from '../db/connection.js';

// CRITICAL: JWT_SECRET must be set in environment variables
// Never use a hardcoded fallback in production
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set!');
  console.error('Please set JWT_SECRET to a strong random value.');
  console.error('Generate one with: openssl rand -base64 32');
  process.exit(1);
}

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
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
      
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
