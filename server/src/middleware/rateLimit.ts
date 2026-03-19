import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

/**
 * Simple in-memory rate limiter middleware
 * @param windowMs - Time window in milliseconds
 * @param max - Maximum number of requests per window
 */
export function createRateLimiter(windowMs: number, max: number) {
  const store: RateLimitStore = {};

  // Cleanup old entries every minute
  setInterval(() => {
    const now = Date.now();
    Object.keys(store).forEach(key => {
      if (store[key].resetTime < now) {
        delete store[key];
      }
    });
  }, 60000);

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    if (!store[key] || store[key].resetTime < now) {
      // First request or window expired
      store[key] = {
        count: 1,
        resetTime: now + windowMs
      };
      return next();
    }

    store[key].count++;

    if (store[key].count > max) {
      const retryAfter = Math.ceil((store[key].resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests, please try again later.',
        retryAfter
      });
    }

    next();
  };
}

/**
 * Pre-configured rate limiter for login endpoints
 * 5 attempts per 15 minutes
 */
export const loginRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5 // max 5 requests
);

/**
 * General API rate limiter using express-rate-limit
 * 300 requests per 15 minutes per IP — blocks abuse without affecting single-user UI
 * (a typical page load fires ~10 API calls; 300/15min = 20 full page loads/min)
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,  // Return RateLimit-* headers
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
