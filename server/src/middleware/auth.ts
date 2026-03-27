import { Request, Response, NextFunction, RequestHandler } from 'express';
import passport from 'passport';

export interface AuthUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
}

// Extend Express Request to include user from passport
declare global {
  namespace Express {
    interface User extends AuthUser {}
  }
}

export type AuthRequest = Request;

export const authenticate: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  passport.authenticate('jwt', { session: false }, (err: Error | null, user: AuthUser | false) => {
    if (err) {
      return res.status(500).json({ error: 'Authentication error' });
    }
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  })(req, res, next);
};

export const requireAdmin: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const user = req.user as AuthUser | undefined;
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }
  next();
};

/** Helper to get typed user from request (use after authenticate middleware) */
export function getUser(req: Request): AuthUser {
  return req.user as AuthUser;
}
