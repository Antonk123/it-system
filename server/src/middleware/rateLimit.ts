import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

export interface RateLimiterOptions {
  skipSuccessfulRequests?: boolean;
  keyGenerator?: (req: Request) => string | undefined;
}

/**
 * Simple in-memory rate limiter middleware.
 *
 * The in-memory store is intentional: IT-Ticket is a single-instance app backed
 * by SQLite, so there is no second process that needs to share rate-limit
 * counters. Storing counts in RAM avoids unnecessary DB writes on every request.
 * Counts reset on server restart — this is acceptable because restarts are
 * infrequent and the window durations are short (≤15 min).
 *
 * If the app ever scales to multiple instances behind a load balancer, this
 * should be replaced with a shared store (e.g. Redis or an SQLite table).
 *
 * @param windowMs - Time window in milliseconds
 * @param max - Maximum number of requests per window
 * @param onLimitExceeded - Optional custom 429 handler (req, res, retryAfterSeconds).
 *   Defaults to a JSON 429 body. Use this for routes where a raw JSON response is
 *   wrong for the context — e.g. a top-level browser navigation that should redirect
 *   instead of rendering JSON.
 * @param options.skipSuccessfulRequests - Räkna bara misslyckade svar (status >= 400):
 *   lyckade anrop ger tillbaka sitt tillskott när svaret är skickat. För login/refresh,
 *   där legitima användare annars tömmer sin egen budget.
 * @param options.keyGenerator - Egen bucket-nyckel (t.ex. användar-id); default är IP.
 */
export function createRateLimiter(
  windowMs: number,
  max: number,
  onLimitExceeded?: (req: Request, res: Response, retryAfter: number) => void,
  options: RateLimiterOptions = {}
) {
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

  // Vid skipSuccessfulRequests: lyckade svar (< 400) drar tillbaka sitt tillskott.
  // Posten fångas som referens — en ny ruta efter fönstret påverkas inte.
  const refundOnSuccess = (res: Response, entry: { count: number }) => {
    if (!options.skipSuccessfulRequests) return;
    res.on('finish', () => {
      if (res.statusCode < 400 && entry.count > 0) entry.count--;
    });
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const key = options.keyGenerator?.(req) ?? (req.ip || req.socket.remoteAddress || 'unknown');
    const now = Date.now();

    if (!store[key] || store[key].resetTime < now) {
      // First request or window expired
      store[key] = {
        count: 1,
        resetTime: now + windowMs
      };
      refundOnSuccess(res, store[key]);
      return next();
    }

    store[key].count++;
    refundOnSuccess(res, store[key]);

    if (store[key].count > max) {
      const retryAfter = Math.ceil((store[key].resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      if (onLimitExceeded) {
        return onLimitExceeded(req, res, retryAfter);
      }
      return res.status(429).json({
        error: 'För många förfrågningar, försök igen om en stund',
        retryAfter
      });
    }

    next();
  };
}

/**
 * Login: 5 misslyckade försök per 15 minuter och IP. Lyckade inloggningar räknas
 * inte — annars låser en delad NAT-adress (kontor) ut sig själv.
 */
export const loginRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  5,
  undefined,
  { skipSuccessfulRequests: true }
);

/**
 * Glömt lösenord: egen budget (5 per 15 min och IP). Svaret är alltid 200, så
 * här räknas varje anrop — det är mejlutskicket som ska skyddas.
 */
export const forgotPasswordRateLimiter = createRateLimiter(15 * 60 * 1000, 5);

/** Återställning: egen budget, lyckade återställningar räknas inte. */
export const resetPasswordRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  10,
  undefined,
  { skipSuccessfulRequests: true }
);

/**
 * Refresh: 60 per 15 minuter och IP (access-token lever 15 min, så en tyst
 * förnyelse per flik och kvart äts snabbt upp av 10). Bara misslyckade
 * förnyelser räknas, så brute-force/replay bromsas utan att bränna legitima.
 */
export const refreshRateLimiter = createRateLimiter(
  15 * 60 * 1000,
  60,
  undefined,
  { skipSuccessfulRequests: true }
);

const KNOWN_IPS_PER_ACCOUNT = 5;

/**
 * Räknare för misslyckade inloggningar per konto (e-post), oberoende av IP.
 * In-memory av samma skäl som createRateLimiter (single-instance). Fast fönster
 * från första felet; nollställs vid lyckad inloggning.
 *
 * Kontolåset kan utnyttjas för att låsa ute en känd användare. Därför minns den
 * också de senaste IP-adresserna kontot lyckats logga in från: rätt lösenord
 * därifrån går igenom trots låset (anroparen avgör, se isKnownIp).
 */
export function createFailureTracker(windowMs: number, max: number) {
  const entries = new Map<string, { count: number; resetTime: number }>();
  const knownIps = new Map<string, string[]>();
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.resetTime < now) entries.delete(key);
    }
  }, 60000);
  if (cleanup.unref) cleanup.unref();

  return {
    /** Sekunder kvar av låsningen, eller 0 om kontot inte är låst. */
    lockedFor(key: string): number {
      const entry = entries.get(key);
      if (!entry || entry.resetTime < Date.now() || entry.count < max) return 0;
      return Math.ceil((entry.resetTime - Date.now()) / 1000);
    },
    recordFailure(key: string): void {
      const now = Date.now();
      const entry = entries.get(key);
      if (!entry || entry.resetTime < now) {
        entries.set(key, { count: 1, resetTime: now + windowMs });
      } else {
        entry.count++;
      }
    },
    reset(key: string): void {
      entries.delete(key);
    },
    /** Lyckad inloggning: nollställ felen och kom ihåg IP:n (de senaste fem per konto). */
    recordSuccess(key: string, ip: string): void {
      entries.delete(key);
      const ips = (knownIps.get(key) ?? []).filter((known) => known !== ip);
      ips.push(ip);
      knownIps.set(key, ips.slice(-KNOWN_IPS_PER_ACCOUNT));
    },
    /** Har kontot tidigare loggat in lyckat från den här IP:n? */
    isKnownIp(key: string, ip: string): boolean {
      return knownIps.get(key)?.includes(ip) ?? false;
    },
  };
}

/** 10 misslyckade inloggningar per konto och 15 minuter. */
export const loginFailureTracker = createFailureTracker(15 * 60 * 1000, 10);

/**
 * Skrivbegränsning för hela API:t: 300 muterande anrop per 5 min och identitet.
 * Nyckeln (användar-id / API-nyckel-id, annars IP) löses av anroparen eftersom
 * authenticate körs per route, efter att den här middlewaren monterats.
 */
export function createWriteRateLimiter(keyGenerator: (req: Request) => string | undefined) {
  return createRateLimiter(5 * 60 * 1000, 300, undefined, { keyGenerator });
}

/**
 * Rate limiter for write endpoints (POST/PUT/DELETE), per IP — används direkt
 * på enskilda routes (tickets, attachments, kb). 60 requests per minute.
 */
export const writeRateLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  60 // max 60 requests
);

/**
 * Rate limiter for public unauthenticated endpoints (ticket form).
 * 5 requests per minute per IP — each submission mails staff, creates a
 * contact and fires webhooks/push, so the budget is deliberately tight.
 */
export const publicWriteRateLimiter = createRateLimiter(
  60 * 1000,
  5
);
