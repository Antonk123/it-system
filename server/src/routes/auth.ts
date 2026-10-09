import { Router, Request, Response } from 'express';
import passport from 'passport';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto, { randomUUID } from 'node:crypto';
import { db } from '../db/connection.js';
import { JWT_SECRET } from '../config/passport.js';
import { authenticate, requireAdmin, AuthRequest, AuthUser } from '../middleware/auth.js';
import {
  createRateLimiter,
  loginRateLimiter,
  forgotPasswordRateLimiter,
  resetPasswordRateLimiter,
  refreshRateLimiter,
  loginFailureTracker,
} from '../middleware/rateLimit.js';
import { sendPasswordResetEmail } from '../lib/email.js';
import { validatePassword, BCRYPT_ROUNDS } from '../lib/passwordPolicy.js';
import { logAudit } from '../lib/auditLog.js';
import { logger } from '../lib/logger.js';
import { cookieSecure } from '../config/cookies.js';
import * as oidcClient from 'openid-client';
import {
  getOidcSettings,
  getOidcConfig,
  getOidcIssuerIdentity,
  verifyOidcClaims,
  findOrLinkOidcUser,
  getOidcProviderHint,
  type OidcUserClaims,
} from '../lib/oidc.js';

/**
 * Rate limiter for change-password endpoint.
 * 5 attempts per 15 minutes per IP — same budget as login. Without this, an
 * attacker holding a stolen/valid JWT could brute-force the user's current
 * password unbounded (change-password gates the new password behind knowing
 * the current one, but nothing previously limited how many guesses it accepted).
 */
const changePasswordRateLimiter = createRateLimiter(15 * 60 * 1000, 5);

const router = Router();

// Token expiration times
const ACCESS_TOKEN_EXPIRY = '15m'; // Short-lived access token (silent refresh handles re-auth)
const REFRESH_TOKEN_EXPIRY_DAYS = 7; // Refresh token valid for 7 days
// En just roterad refresh-token godtas igen så här länge (två flikar som förnyar samtidigt).
const REFRESH_ROTATION_GRACE_MS = 10 * 1000;

const LOCKED_ACCOUNT_MESSAGE = 'För många misslyckade inloggningsförsök, försök igen om en stund';
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

// Generate cryptographically secure refresh token
function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Refresh-tokens lagras som sha256-hex i kolumnen `token` — en läckt DB-dump ger
// därmed inga användbara sessioner.
function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Calculate refresh token expiration date
function getRefreshTokenExpiry(): string {
  const date = new Date();
  date.setDate(date.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);
  return date.toISOString();
}

// Skapar en refresh-token åt användaren och returnerar råvärdet (för cookien) + radens id.
function issueRefreshToken(userId: string): { token: string; id: string } {
  const token = generateRefreshToken();
  const id = randomUUID();
  db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
  ).run(id, userId, hashRefreshToken(token), getRefreshTokenExpiry());
  return { token, id };
}

// `tv` = users.token_version: höjs vid lösenordsbyte så att gamla access-tokens dör direkt.
function signAccessToken(user: { id: string; email: string; role: string }, tokenVersion: number): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, tv: tokenVersion },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

// Återkallar hela kedjan som börjar i `startId` genom att följa replaced_by.
// UNION avdupar raderna, så en trasig (cirkulär) kedja ändå terminerar.
function revokeRefreshFamily(startId: string): void {
  db.prepare(`
    WITH RECURSIVE chain(id) AS (
      SELECT id FROM refresh_tokens WHERE id = ?
      UNION
      SELECT r.replaced_by FROM refresh_tokens r JOIN chain c ON r.id = c.id WHERE r.replaced_by IS NOT NULL
    )
    UPDATE refresh_tokens SET revoked = 1 WHERE id IN (SELECT id FROM chain)
  `).run(startId);
}

// Refresh-token lagras i en HttpOnly-cookie (ej läsbar via JS) istället för
// localStorage → en XSS kan inte längre stjäla den 7-dagars sessionen.
// Scopad till /api/auth så den bara skickas till refresh/logout. SameSite=strict
// (refresh sker som same-site-fetch från SPA:n). Cookie-parser är redan monterad.
const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/auth';
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'strict' as const,
    path: REFRESH_COOKIE_PATH,
  };
}
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...refreshCookieOptions(),
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
}
function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}
// Refresh-token läses enbart från cookien (aldrig från body).
function readRefreshToken(req: Request): string | undefined {
  const token = req.cookies?.[REFRESH_COOKIE];
  return typeof token === 'string' && token ? token : undefined;
}

type LoginUser = Required<AuthUser>;

// Login with rate limiting (5 failed attempts per 15 minutes per IP, 10 per account)
router.post('/login', loginRateLimiter, (req: Request, res: Response) => {
  const rawEmail: unknown = req.body?.email;
  const accountKey = typeof rawEmail === 'string' ? rawEmail.toLowerCase().trim() : null;

  if (accountKey) {
    const lockedFor = loginFailureTracker.lockedFor(accountKey);
    if (lockedFor > 0) {
      res.set('Retry-After', String(lockedFor));
      return res.status(429).json({ error: LOCKED_ACCOUNT_MESSAGE, retryAfter: lockedFor });
    }
  }

  passport.authenticate('local', { session: false }, (err: Error | null, user: LoginUser | false, info: { message?: string }) => {
    if (err) {
      return res.status(500).json({ error: 'Login failed' });
    }
    if (!user) {
      if (accountKey) loginFailureTracker.recordFailure(accountKey);
      // Råa fältet kan innehålla vad som helst (t.ex. ett inklistrat lösenord) — logga bara e-postlika värden.
      const loggedEmail = typeof rawEmail === 'string' && EMAIL_SHAPE.test(rawEmail)
        ? rawEmail.slice(0, 254)
        : '<ogiltigt format>';
      logAudit(null, 'login_failure', 'session', null, `email: ${loggedEmail}`, req.ip);
      return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    }

    try {
      if (accountKey) loginFailureTracker.reset(accountKey);
      const accessToken = signAccessToken(user, user.tokenVersion);

      // Generate long-lived refresh token (7 days) and store its hash
      const { token: refreshToken } = issueRefreshToken(user.id);

      logAudit(user.id, 'login_success', 'session', user.id, null, req.ip);

      // Refresh-token sätts som HttpOnly-cookie — returneras INTE i body
      // (förhindrar att klient-JS/XSS får tag på den).
      setRefreshCookie(res, refreshToken);

      res.json({
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          mustChangePassword: user.mustChangePassword,
        },
        token: accessToken, // For backward compatibility
        accessToken,
      });
    } catch (error) {
      logger.error('Error generating tokens:', { error: String(error) });
      return res.status(500).json({ error: 'Failed to generate tokens' });
    }
  })(req, res);
});

// Refresh access token using refresh token (cookie only)
router.post('/refresh', refreshRateLimiter, (req: Request, res: Response) => {
  const refreshToken = readRefreshToken(req);

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    interface RefreshTokenRow {
      id: string;
      user_id: string;
      expires_at: string;
      revoked: number;
      replaced_by: string | null;
      last_used_at: string | null;
    }

    const tokenRow = db.prepare(`
      SELECT id, user_id, expires_at, revoked, replaced_by, last_used_at
      FROM refresh_tokens
      WHERE token = ?
    `).get(hashRefreshToken(refreshToken)) as RefreshTokenRow | undefined;

    if (!tokenRow) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Get user details
    interface UserRow {
      id: string;
      email: string;
      role: string;
      token_version: number;
    }
    const loadUser = () => db.prepare('SELECT id, email, role, token_version FROM users WHERE id = ?')
      .get(tokenRow.user_id) as UserRow | undefined;

    if (tokenRow.revoked === 1) {
      // Roterad men visad igen: antingen två flikar som tävlar (godtas inom nådetiden,
      // utan ny cookie — flik 1 har redan fått efterträdaren) eller en stulen/återanvänd
      // token, då hela kedjan återkallas.
      if (tokenRow.replaced_by) {
        const rotatedAt = tokenRow.last_used_at ? Date.parse(tokenRow.last_used_at) : 0;
        const successor = db.prepare('SELECT revoked FROM refresh_tokens WHERE id = ?')
          .get(tokenRow.replaced_by) as { revoked: number } | undefined;
        if (successor?.revoked === 0 && Date.now() - rotatedAt <= REFRESH_ROTATION_GRACE_MS) {
          const graceUser = loadUser();
          if (!graceUser) {
            return res.status(401).json({ error: 'User not found' });
          }
          const graceAccessToken = signAccessToken(graceUser, graceUser.token_version);
          return res.json({ accessToken: graceAccessToken, token: graceAccessToken });
        }
        revokeRefreshFamily(tokenRow.id);
        logAudit(tokenRow.user_id, 'refresh_token_reuse', 'session', tokenRow.user_id, null, req.ip);
      }
      return res.status(401).json({ error: 'Refresh token has been revoked' });
    }

    // Check if token is expired
    const now = new Date();
    const expiresAt = new Date(tokenRow.expires_at);

    if (now > expiresAt) {
      // Clean up expired token
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(tokenRow.id);
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    const user = loadUser();

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate new access token
    const accessToken = signAccessToken(user, user.token_version);

    // Atomically rotate: markera den gamla som ersatt (behålls för återanvändnings-
    // detektering) och lägg in den nya i samma transaktion. `revoked = 0` i WHERE
    // gör att bara en samtidig förnyelse vinner.
    const newRefreshToken = generateRefreshToken();
    const newRefreshTokenId = randomUUID();
    const newExpiresAt = getRefreshTokenExpiry();
    const rotateToken = db.transaction(() => {
      const claimed = db.prepare(
        'UPDATE refresh_tokens SET revoked = 1, replaced_by = ?, last_used_at = ? WHERE id = ? AND revoked = 0'
      ).run(newRefreshTokenId, now.toISOString(), tokenRow.id);
      if (claimed.changes !== 1) return false;
      db.prepare(
        'INSERT INTO refresh_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
      ).run(newRefreshTokenId, tokenRow.user_id, hashRefreshToken(newRefreshToken), newExpiresAt);
      return true;
    });
    if (!rotateToken()) {
      return res.status(401).json({ error: 'Refresh token has been revoked' });
    }

    // Roterad refresh-token i ny HttpOnly-cookie — ej i body.
    setRefreshCookie(res, newRefreshToken);

    res.json({
      accessToken,
      token: accessToken, // For backward compatibility
    });
  } catch (error) {
    logger.error('Error refreshing token:', { error: String(error) });
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// Logout (revoke refresh token). Kräver ingen access-token: en utgången token ska
// inte hindra utloggning, och cookien identifierar sessionen.
router.post('/logout', (req: Request, res: Response) => {
  const refreshToken = readRefreshToken(req);

  // Rensa alltid cookien, även om token saknas i DB.
  clearRefreshCookie(res);

  try {
    if (refreshToken) {
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(hashRefreshToken(refreshToken));
    }
    res.status(204).end();
  } catch (error) {
    logger.error('Error during logout:', { error: String(error) });
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// Get current user
router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  const row = db.prepare('SELECT must_change_password FROM users WHERE id = ?')
    .get(req.user!.id) as { must_change_password: number } | undefined;
  res.json({ user: { ...req.user, mustChangePassword: row?.must_change_password === 1 } });
});

// Change password
router.post('/change-password', authenticate, changePasswordRateLimiter, async (req: AuthRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }

  // Strong password policy: shared with admin user-create + password reset
  const policy = validatePassword(newPassword);
  if (!policy.ok) {
    return res.status(400).json({ error: policy.error });
  }

  try {
    interface UserRow {
      password_hash: string;
    }
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as UserRow | undefined;

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    // Update the hash and revoke every existing refresh token for this user in
    // one transaction, so a password change logs out all other sessions/devices
    // (OWASP session-management). Mirrors the reset-password handler below.
    // token_version höjs så även utestående access-tokens slutar gälla direkt.
    const applyChange = db.transaction(() => {
      db.prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?'
      ).run(newHash, req.user!.id);
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(req.user!.id);
      return db.prepare('SELECT token_version FROM users WHERE id = ?').get(req.user!.id) as { token_version: number };
    });
    const { token_version: tokenVersion } = applyChange();

    // Den här sessionen ska överleva bytet: ny refresh-cookie + ny access-token.
    setRefreshCookie(res, issueRefreshToken(req.user!.id).token);
    const accessToken = signAccessToken(req.user!, tokenVersion);

    logAudit(req.user!.id, 'password_change', 'user', req.user!.id, null, req.ip, req.apiKey?.id ?? null);

    res.json({ message: 'Password changed successfully', accessToken, token: accessToken });
  } catch (error) {
    logger.error('Error changing password:', { error: String(error) });
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ── Password reset (forgot / reset) ──────────────────────────────────

const RESET_TOKEN_EXPIRY_MINUTES = 60;
// Generic response — sent regardless of whether the email matches a user, so
// attackers can't enumerate accounts via this endpoint.
const FORGOT_GENERIC_RESPONSE = {
  message: 'Om e-postadressen finns i systemet har en återställningslänk skickats.',
};

// Körs EFTER att svaret skickats: mejlutskicket tar sekunder och skulle annars
// avslöja via svarstiden om adressen finns.
async function issueResetLink(email: string): Promise<void> {
  const user = db.prepare('SELECT id, email, display_name FROM users WHERE LOWER(email) = LOWER(?)')
    .get(email) as { id: string; email: string; display_name: string | null } | undefined;
  if (!user) return;

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const issueTokens = db.transaction(() => {
    // Invalidate previously issued unused tokens for this user — only the latest
    // request can complete a reset.
    db.prepare(`UPDATE password_reset_tokens
                SET used_at = CURRENT_TIMESTAMP
                WHERE user_id = ? AND used_at IS NULL`).run(user.id);
    db.prepare(`INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
                VALUES (?, ?, ?, ?)`).run(randomUUID(), user.id, tokenHash, expiresAt);
  });
  issueTokens();

  const baseUrl = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (!baseUrl) {
    logger.warn('[forgot-password] APP_BASE_URL not configured — reset link cannot be built');
    return;
  }
  await sendPasswordResetEmail({
    toEmail: user.email,
    toName: user.display_name || user.email.split('@')[0],
    resetUrl: `${baseUrl}/reset-password/${token}`,
    expiryMinutes: RESET_TOKEN_EXPIRY_MINUTES,
  });
}

router.post('/forgot-password', forgotPasswordRateLimiter, (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'E-post krävs' });
  }

  res.json(FORGOT_GENERIC_RESPONSE);
  setImmediate(() => {
    void issueResetLink(email.trim()).catch((err) => {
      logger.error('[forgot-password] failed:', { error: String(err) });
    });
  });
});

router.post('/reset-password', resetPasswordRateLimiter, async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Ogiltig återställningslänk' });
  }
  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Nytt lösenord krävs' });
  }

  // Samma policy som change-password och admin-create — centraliserad i passwordPolicy.ts.
  const policy = validatePassword(newPassword);
  if (!policy.ok) {
    return res.status(400).json({ error: policy.error });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db.prepare(`SELECT id, user_id, expires_at, used_at
                            FROM password_reset_tokens
                            WHERE token_hash = ?`)
      .get(tokenHash) as { id: string; user_id: string; expires_at: string; used_at: string | null } | undefined;

    if (!row) {
      return res.status(400).json({ error: 'Ogiltig eller utgången återställningslänk' });
    }
    if (row.used_at) {
      return res.status(400).json({ error: 'Länken har redan använts' });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Länken har gått ut' });
    }

    // Förbruka länken atomärt INNAN den dyra hashningen: två samtidiga anrop med
    // samma token kan annars båda passera used_at-kontrollen ovan.
    const claimed = db.prepare(
      'UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL'
    ).run(row.id);
    if (claimed.changes !== 1) {
      return res.status(400).json({ error: 'Länken har redan använts' });
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const applyReset = db.transaction(() => {
      db.prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?'
      ).run(passwordHash, row.user_id);
      // Force re-login on every device — the old refresh tokens may be in attacker
      // hands if the reset was triggered by a compromise.
      db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(row.user_id);
    });
    applyReset();

    return res.json({ message: 'Lösenordet har återställts. Logga in med ditt nya lösenord.' });
  } catch (err) {
    logger.error('[reset-password] failed:', { error: String(err) });
    return res.status(500).json({ error: 'Kunde inte återställa lösenordet' });
  }
});

// GET /audit-log — admin-only audit log viewer
router.get('/audit-log', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const entityType = req.query.entity_type as string;
    const action = req.query.action as string;

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    if (entityType) { where += ' AND a.entity_type = ?'; params.push(entityType); }
    if (action) { where += ' AND a.action = ?'; params.push(action); }

    // G3: joina in API-nyckelns NAMN (aldrig key_hash/key_prefix — hemligt) så
    // granskningsloggens UI kan visa VILKEN nyckel som utförde åtgärden, inte
    // bara att api_key_id är satt. LEFT JOIN eftersom nyckeln kan ha raderats
    // sedan dess (api_key_id är då satt men namnet NULL — UI:t faller tillbaka
    // till ett förkortat id).
    const entries = db.prepare(`
      SELECT a.*, u.email as user_email, u.display_name as user_display_name, k.name as api_key_name
      FROM audit_log a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN api_keys k ON a.api_key_id = k.id
      ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = (db.prepare(`SELECT COUNT(*) as count FROM audit_log a ${where}`).get(...params) as { count: number }).count;

    res.json({ entries, total, limit, offset });
  } catch (error) {
    logger.error('Error fetching audit log', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// ── SSO / OIDC (generisk; Entra ID första provider). Opt-in via env. ─────────
// Separata instanser för login/callback — annars delar de en gemensam räknare
// (nycklad per IP) och en hel SSO-cykel (login + callback) förbrukar 2 av
// budgeten, vilket halverar den effektiva gränsen till ~10 cykler/IP/kvart.
const oidcLoginRateLimiter = createRateLimiter(15 * 60 * 1000, 20);
// Callbacken är en top-level-navigation från IdP:n (browser-redirect), inte ett
// fetch/XHR-anrop — ett rått JSON-429-svar skulle renderas som text i webbläsaren
// istället för att ta användaren tillbaka till inloggningen. Redirecta istället.
const oidcCallbackRateLimiter = createRateLimiter(15 * 60 * 1000, 20, (_req, res) => {
  res.redirect('/login?sso_error=failed');
});
const OIDC_TX_COOKIE = 'oidcTx';
const OIDC_COOKIE_PATH = '/api/auth/oidc';
function oidcTxCookieOptions() {
  return { httpOnly: true, secure: cookieSecure(), sameSite: 'lax' as const, path: OIDC_COOKIE_PATH };
}

interface OidcTx {
  state: string;
  nonce: string;
  codeVerifier: string;
}

// Cookien är HttpOnly och vår egen, men den kommer ändå in via requesten och får
// därför inte castas blint med `as`: en klippt/manipulerad cookie skulle annars
// ge `undefined` som expectedState/expectedNonce/pkceCodeVerifier ända ned i
// biblioteket, där felet blir svårläst istället för ett rent avbrott.
function parseOidcTx(raw: string): OidcTx | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { state, nonce, codeVerifier } = parsed as Record<string, unknown>;
  const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!isNonEmpty(state) || !isNonEmpty(nonce) || !isNonEmpty(codeVerifier)) return null;
  return { state, nonce, codeVerifier };
}

// Claim-styrda strängar går rakt in i audit-loggens details-kolumn. En IdP (eller
// ett manipulerat konto) kan skicka godtyckligt långa värden — trunkera så att
// en enda inloggning inte kan svälla loggen eller göra den oläsbar.
// Strippar ÄVEN kontrolltecken (inkl. \n/\r) INNAN trunkeringen: audit_log.details
// är en fri textkolumn utan escaping, och en claim med inbäddade radbrytningar
// (t.ex. sub: "äkta-sub\n2026-01-01 admin login_success ...") skulle annars
// rendera som flera skenbart legitima loggrader för den som läser loggen rått.
function truncateForAudit(value: unknown, max = 120): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  // eslint-disable-next-line no-control-regex -- avsiktligt: vi vill just träffa styrtecken.
  const sanitized = s.replace(/[\x00-\x1f\x7f]/g, ' ');
  return sanitized.length > max ? `${sanitized.slice(0, max)}…` : sanitized;
}

// oauth4webapi kastar STRUKTURERADE fel (ResponseBodyError, AuthorizationResponseError,
// WWWAuthenticateChallengeError) vars `error`/`error_description` bär IdP:ns FAKTISKA orsak
// — för Entra är det AADSTS-koden. `String(error)` ger bara den generiska texten
// "server responded with an error in the response body", och då ser fel client secret
// (AADSTS7000215), redirect-URI registrerad som SPA i stället för Web (AADSTS7000218) och
// en förbrukad authorization-kod (invalid_grant) HELT identiska ut i loggen. Det gjorde
// första skarpa inloggningen på prod 2026-08-13 omöjlig att felsöka utan gissningar.
// Fälten innehåller inga hemligheter — Entra skickar AADSTS-kod, trace-/correlation-id
// och tidsstämpel — men de trunkeras och rensas från styrtecken som allt annat vi loggar.
export function describeIdpError(error: unknown): Record<string, unknown> {
  const e = error as { error?: unknown; error_description?: unknown; status?: unknown; code?: unknown };
  const details: Record<string, unknown> = { error: truncateForAudit(String(error), 300) };
  if (typeof e?.error === 'string') details.idpError = truncateForAudit(e.error, 120);
  if (typeof e?.error_description === 'string') {
    details.idpErrorDescription = truncateForAudit(e.error_description, 400);
  }
  if (typeof e?.status === 'number') details.idpHttpStatus = e.status;
  if (typeof e?.code === 'string') details.idpErrorCode = truncateForAudit(e.code, 60);
  return details;
}

router.get('/oidc/enabled', (_req: Request, res: Response) => {
  const settings = getOidcSettings();
  res.json({
    enabled: settings !== null,
    label: settings?.buttonLabel ?? null,
    // Härledd ur den KONFIGURERADE issuerns värdnamn — null (aldrig gissad ur
    // buttonLabel) när SSO är av eller providern inte är Entra.
    provider: settings ? getOidcProviderHint(settings.issuerUrl) : null,
  });
});

router.get('/oidc/login', oidcLoginRateLimiter, async (_req: Request, res: Response) => {
  const settings = getOidcSettings();
  if (!settings) {
    return res.status(503).json({ error: 'SSO är inte konfigurerat' });
  }
  try {
    const config = await getOidcConfig();
    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);
    const state = oidcClient.randomState();
    const nonce = oidcClient.randomNonce();
    // Transaktions-state i kortlivad HttpOnly-cookie. SameSite=Lax krävs för
    // att cookien ska följa med på top-level-returen från IdP:n.
    res.cookie(OIDC_TX_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), {
      ...oidcTxCookieOptions(),
      maxAge: 10 * 60 * 1000,
    });
    const authUrl = oidcClient.buildAuthorizationUrl(config, {
      redirect_uri: settings.redirectUri,
      scope: 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    res.redirect(authUrl.href);
  } catch (error) {
    logger.error('OIDC login init failed', describeIdpError(error));
    res.status(503).json({ error: 'SSO-tjänsten kunde inte nås' });
  }
});

router.get('/oidc/callback', oidcCallbackRateLimiter, async (req: Request, res: Response) => {
  const settings = getOidcSettings();
  if (!settings) {
    // Callbacken är en top-level browser-navigation (IdP:ns redirect landar
    // här direkt, inte via fetch/XHR) — samma resonemang som rate-limitern
    // ovan. Ett rått JSON-503 skulle renderas som text i webbläsaren istället
    // för att ta användaren tillbaka till inloggningen.
    // /oidc/login behåller däremot JSON-503: den är visserligen också en
    // navigation (Login-sidans SSO-knapp är ett <a href>), men SSO-knappen
    // renderas bara när /oidc/enabled säger true, så en träff på /oidc/login
    // med avstängd SSO är per definition ett fel — och deploy-runbookets
    // rök-test skiljer "SSO av" (503) från "SSO uppe" (302 till IdP:n) på just
    // den statuskoden.
    return res.redirect('/login?sso_error=failed');
  }
  const clearTxCookie = () => res.clearCookie(OIDC_TX_COOKIE, oidcTxCookieOptions());
  try {
    const rawTx = req.cookies?.[OIDC_TX_COOKIE] as string | undefined;
    if (!rawTx) {
      // Ingen pågående SSO-transaktion (cookie utgången/saknas) — starta om flödet.
      return res.redirect('/login?sso_error=failed');
    }
    const tx = parseOidcTx(rawTx);
    if (!tx) {
      // Trasig/manipulerad transaktionscookie — behandla som ingen transaktion alls.
      clearTxCookie();
      return res.redirect('/login?sso_error=failed');
    }
    const config = await getOidcConfig();

    // authorizationCodeGrant läser code/state ur URL:en och verifierar
    // state/nonce/PKCE samt id_tokenets aud, exp/nbf och iss åt oss.
    // OBS: SIGNATUREN kontrolleras INTE mot JWKS — det kräver
    // enableNonRepudiationChecks() på configen, vilket vi aldrig anropar.
    // Förtroendet vilar istället på att tokenet hämtas direkt från IdP:ns
    // token-endpoint över TLS med confidential-client-autentisering, vilket
    // OIDC Core 3.1.3.7 p.6 uttryckligen tillåter som alternativ till
    // signaturverifiering. iss-kontrollen görs dessutom om av oss i
    // verifyOidcClaims — bibliotekets egen är opålitlig för Entra.
    const currentUrl = new URL(settings.redirectUri);
    currentUrl.search = new URL(req.originalUrl, 'http://internal').search;
    const tokens = await oidcClient.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
    });
    clearTxCookie();

    const claims = tokens.claims();
    if (!claims?.sub) {
      return res.redirect('/login?sso_error=failed');
    }

    // Kastar om discovery gav en platshållar-issuer (multitenant) → catch:en
    // nedan redirectar till failed. Ingen DB-skrivning har skett vid det laget.
    const identity = getOidcIssuerIdentity(config);

    // Egen iss-/tid-kontroll INNAN någon skrivning: bibliotekets iss-kontroll
    // är för Entra härledd ur tokenets egen tid-claim och kan därför inte
    // ensam garantera att bara vår tenant kommer in.
    const claimsReason = verifyOidcClaims(claims as unknown as Record<string, unknown>, identity);
    if (claimsReason) {
      logAudit(
        null,
        'login_failure',
        'session',
        null,
        `oidc: ${claimsReason} (sub ${truncateForAudit(claims.sub)})`,
        req.ip
      );
      return res.redirect('/login?sso_error=failed');
    }

    const match = findOrLinkOidcUser(claims as unknown as OidcUserClaims, identity);
    if (!match.ok) {
      // Ingen JIT: okända identiteter nekas. IdP:ns tokens kastas (inget persisteras).
      // Logga även den försökta e-postadressen — lösenordsloginet gör det, och
      // utan den går ett avslag inte att felsöka mot rätt konto.
      logAudit(
        null,
        'login_failure',
        'session',
        null,
        `oidc: ${match.reason} (sub ${truncateForAudit(claims.sub)}, e-post ${
          match.attemptedEmail === null ? 'okänd' : truncateForAudit(match.attemptedEmail)
        })`,
        req.ip
      );
      // Bara unknown_user särskiljs mot klienten (åtgärdbart för användaren);
      // övriga orsaker läcker vi inte — de säger något om kontots tillstånd.
      return res.redirect(
        match.reason === 'unknown_user' ? '/login?sso_error=unknown_user' : '/login?sso_error=failed'
      );
    }
    const user = match.user;
    if (match.linked) {
      // Egen händelse: en länkning ska ske EN gång per konto. Dyker den upp
      // oväntat igen är det ett tecken på att en identitet bytts ut.
      logAudit(user.id, 'oidc_link', 'user', user.id, `oidc-identitet länkad (iss ${identity.issuer})`, req.ip);
    }

    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    setRefreshCookie(res, issueRefreshToken(user.id).token);
    logAudit(user.id, 'login_success', 'session', user.id, 'oidc', req.ip);
    // Access-token hämtas av SPA:n via befintliga POST /refresh (cookien ovan).
    // Fast intern path — aldrig redirect till något från requesten (open redirect).
    res.redirect('/login?sso=1');
  } catch (error) {
    clearTxCookie();
    logger.error('OIDC callback failed', describeIdpError(error));
    res.redirect('/login?sso_error=failed');
  }
});

export default router;
