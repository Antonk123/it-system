import { Request, Response, NextFunction } from 'express';

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

  // Cleanup old entries every minute — store ref to allow cleanup on shutdown
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    Object.keys(store).forEach(key => {
      if (store[key].resetTime < now) {
        delete store[key];
      }
    });
  }, 60000);
  // Allow Node to exit without waiting for this interval
  if (cleanupInterval.unref) cleanupInterval.unref();

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
 * Rate limiter for write endpoints (POST/PUT/DELETE)
 * 60 requests per minute
 */
export const writeRateLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  60 // max 60 requests
);

/**
 * Rate limiter for public unauthenticated endpoints (ticket form).
 * 30 requests per minute per IP — generous enough for legitimate use but
 * blocks attempts to DoS or fill the DB with bot submissions.
 */
export const publicWriteRateLimiter = createRateLimiter(
  60 * 1000,
  30
);

/**
 * Rate limiter for public AI endpoints. Each call costs a real Anthropic API
 * request, so we throttle hard: 10 per minute per IP.
 */
export const publicAiRateLimiter = createRateLimiter(
  60 * 1000,
  10
);
