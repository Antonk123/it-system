import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { db } from '../db/connection.js';
import { authenticate, requireAdmin, AuthRequest, isEffectiveAdmin } from '../middleware/auth.js';
import { validatePassword } from '../lib/passwordPolicy.js';
import { logAudit } from '../lib/auditLog.js';
import { logger } from '../lib/logger.js';
import { normalizeEmail } from '../lib/oidc.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DISPLAY_NAME_MAX_LENGTH = 100;

const router = Router();

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
  last_login: string | null;
  oidc_sub: string | null;
}

// Get all system users. Auth:ade users får en reduced payload (för
// assignee-dropdown och @-mentions); admins får fullständigt payload (email,
// lastSignIn, etc) för Administration → Användare-tabben.
router.get('/', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const users = db.prepare(`
      SELECT id, email, display_name, role, created_at, last_login, oidc_sub FROM users ORDER BY created_at DESC
    `).all() as Omit<UserRow, 'password_hash'>[];

    const isAdmin = isEffectiveAdmin(req);

    const mapped = users.map(u => isAdmin
      ? {
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          role: u.role,
          createdAt: u.created_at,
          lastSignIn: u.last_login,
          emailConfirmed: true,
          // Bara *om* kontot är SSO-länkat, aldrig sub/issuer-värdet självt:
          // subject-identifieraren är en stabil nyckel mot IdP:n och issuern
          // avslöjar vilken tenant instansen litar på — inget av det behöver
          // klienten för att rendera en "koppla loss"-knapp.
          ssoLinked: u.oidc_sub !== null,
        }
      : {
          id: u.id,
          displayName: u.display_name,
          role: u.role,
        }
    );

    res.json({ users: mapped });
  } catch (error) {
    logger.error('Error fetching users:', { error: String(error) });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create new user (admin only)
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const { email, password, role, displayName } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'E-post krävs' });
  }

  // Validera e-postformat — tidigare accepterades vad som helst.
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ error: 'Ogiltigt e-postformat' });
  }

  // Validera displayName-längd om angivet (1-100 tecken efter trim).
  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string') {
      return res.status(400).json({ error: 'displayName måste vara en sträng' });
    }
    const trimmed = displayName.trim();
    if (trimmed.length > 0 && trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
      return res.status(400).json({ error: `Visningsnamn får vara max ${DISPLAY_NAME_MAX_LENGTH} tecken` });
    }
  }

  // Om admin sätter ett konkret lösenord ska det följa samma policy som
  // change-password / reset-password. Auto-genererade lösenord (32 tecken hex,
  // utan specialtecken) skickas tillbaka som temporaryPassword och måste
  // bytas vid första inloggning — de behöver inte uppfylla policyn.
  if (password !== undefined && password !== null && password !== '') {
    const policy = validatePassword(password);
    if (!policy.ok) {
      return res.status(400).json({ error: policy.error });
    }
  }

  // Generate a cryptographically secure random password if not provided
  // Using crypto.randomBytes instead of Math.random for security
  const userPassword = password || crypto.randomBytes(16).toString('hex');

  try {
    // Dubblettkontrollen är SKIFTLÄGESOKÄNSLIG trots att users.email är UNIQUE
    // med BINARY-kollation. VARFÖR: annars kan 'Anton@x.se' skapas bredvid
    // 'anton@x.se' — UNIQUE-indexet ser dem som olika — och det tillståndet slår
    // permanent ut SSO för användaren: findOrLinkOidcUser matchar e-post
    // skiftlägesokänsligt, hittar två rader och avslår fail-closed med
    // 'email_ambiguous'. Kontrollen här är enda stället som hindrar tillståndet
    // (ingen migration, unikhetsindexet är orört).
    //
    // VARFÖR jämförelse i JS och inte `WHERE lower(email) = ?`: SQLites lower()
    // är ASCII-only medan JS toLowerCase() är Unicode-medveten — 'Åsa.Ö@x.se'
    // blir oförändrad i SQLite men 'åsa.ö@x.se' i JS. En SQL-baserad kontroll
    // skulle alltså missa dubbletter med diakriter, precis de fall som sedan
    // fastnar i 'email_ambiguous'.
    //
    // normalizeEmail (importerad från lib/oidc.ts, INTE en lokal .toLowerCase())
    // NFC-normaliserar också: 'ö' kan lagras som ETT tecken (NFC) eller som
    // 'o' + ett kombinerande tremaljud (NFD) — olika strängar i JS, samma
    // adress för en människa. Utan NFC-steget skulle två rader i olika
    // Unicode-normalform för samma adress båda passera den här kontrollen och
    // sedan permanent låsa kontots SSO i 'email_ambiguous' (findOrLinkOidcUser
    // NFC-normaliserar båda sidor vid matchning). Samma funktion på båda
    // ställena är avsiktligt — två separata implementationer av samma regel
    // driver isär förr eller senare.
    const needle = normalizeEmail(email);
    const existing = (db.prepare('SELECT email FROM users').all() as { email: string }[])
      .some(u => normalizeEmail(u.email) === needle);
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(userPassword, 10);
    const userRole = role === 'admin' ? 'admin' : 'user';
    const contact = db.prepare('SELECT name FROM contacts WHERE email = ?').get(email) as { name: string } | undefined;
    const resolvedDisplayName = typeof displayName === 'string' && displayName.trim()
      ? displayName.trim()
      : contact?.name || null;

    try {
      // Insert user - UNIQUE constraint on email will catch race conditions
      db.prepare(`
        INSERT INTO users (id, email, password_hash, role, display_name)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, email, passwordHash, userRole, resolvedDisplayName);

      logAudit(req.user!.id, 'user_create', 'user', id, `email: ${email}, role: ${userRole}`, req.ip, req.apiKey?.id ?? null);

      res.status(201).json({
        message: 'User created',
        user: { id, email, role: userRole, displayName: resolvedDisplayName },
        temporaryPassword: password ? undefined : userPassword, // Only return if auto-generated
      });
    } catch (insertError: any) {
      // Handle race condition: Another request created the same user between check and insert
      if (insertError.message && insertError.message.includes('UNIQUE constraint')) {
        return res.status(409).json({ error: 'Email already registered (race condition detected)' });
      }
      throw insertError; // Re-throw if it's not a UNIQUE constraint error
    }
  } catch (error) {
    logger.error('Error creating user:', { error: String(error) });
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (admin only) — role, displayName och/eller nollställd SSO-länk
router.patch('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  const { role, displayName, clearSsoLink } = req.body as {
    role?: unknown;
    displayName?: unknown;
    clearSsoLink?: unknown;
  };

  // audit: egen etikett när `kolumn: värde` inte är begripligt i loggen.
  // null = kolumnen ingår i en annan posts etikett och ska inte dubbelloggas.
  const updates: { column: string; value: unknown; audit?: string | null }[] = [];

  // Role-validering (oförändrad semantik — bara om fältet faktiskt skickas).
  if (role !== undefined) {
    if (typeof role !== 'string' || !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Ogiltig roll' });
    }
    // Förhindra att admin tar bort sin egen admin-access.
    if (req.params.id === req.user!.id && role !== 'admin') {
      return res.status(400).json({ error: 'Du kan inte ta bort din egen admin-åtkomst' });
    }
    updates.push({ column: 'role', value: role });
  }

  // displayName-validering (1-100 tecken efter trim). Tom sträng tolkas som
  // "rensa fältet" och sparas som NULL.
  if (displayName !== undefined) {
    if (displayName === null) {
      updates.push({ column: 'display_name', value: null });
    } else if (typeof displayName !== 'string') {
      return res.status(400).json({ error: 'displayName måste vara en sträng' });
    } else {
      const trimmed = displayName.trim();
      if (trimmed.length === 0) {
        updates.push({ column: 'display_name', value: null });
      } else if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
        return res.status(400).json({ error: `Visningsnamn får vara max ${DISPLAY_NAME_MAX_LENGTH} tecken` });
      } else {
        updates.push({ column: 'display_name', value: trimmed });
      }
    }
  }

  // clearSsoLink nollar BÅDA identitetskolumnerna. Matchningen sker på paret
  // (oidc_sub, oidc_iss) — lämnas oidc_iss kvar pekar kontot fortfarande på en
  // halv identitet. Behövs när en e-postadress byter ägare (någon slutar, en ny
  // anställd får samma adress): utan en väg att nolla länken fastnar den nya
  // medarbetaren i sub_conflict för alltid.
  if (clearSsoLink !== undefined) {
    if (typeof clearSsoLink !== 'boolean') {
      return res.status(400).json({ error: 'clearSsoLink måste vara true eller false' });
    }
    if (clearSsoLink) {
      updates.push({ column: 'oidc_sub', value: null, audit: 'sso_link: cleared' });
      updates.push({ column: 'oidc_iss', value: null, audit: null });
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Inget att uppdatera (skicka role, displayName och/eller clearSsoLink)' });
  }

  try {
    const setClause = updates.map(u => `${u.column} = ?`).join(', ');
    const values = updates.map(u => u.value);

    // Att nolla länken räcker inte: hela användningsfallet är att FEL person kan
    // vara inloggad (e-postadress som bytt ägare, felaktig länkning). Den
    // sessionen lever kvar i upp till 7 dagar och roterar vidare på egen hand —
    // så refresh-tokens måste revoke:as i SAMMA transaktion som rensningen,
    // annars finns ett fönster där länken är borta men sessionen kvar.
    // Samma mönster som change-password / reset-password i routes/auth.ts.
    const applyUpdate = db.transaction(() => {
      const result = db.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).run(...values, req.params.id);
      if (result.changes === 0) return 0;
      if (clearSsoLink === true) {
        db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(req.params.id);
      }
      return result.changes;
    });
    const changes = applyUpdate();

    if (changes === 0) {
      return res.status(404).json({ error: 'Användaren hittades inte' });
    }

    const changedFields = updates
      .filter(u => u.audit !== null)
      .map(u => u.audit ?? `${u.column}: ${u.value}`)
      .join(', ');
    logAudit(req.user!.id, 'user_update', 'user', req.params.id, changedFields, req.ip, req.apiKey?.id ?? null);

    res.json({ message: 'Användaren uppdaterades' });
  } catch (error) {
    logger.error('Error updating user:', { error: String(error) });
    res.status(500).json({ error: 'Kunde inte uppdatera användare' });
  }
});

// Delete user (admin only)
router.delete('/:id', authenticate, requireAdmin, (req: AuthRequest, res: Response) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.user!.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logAudit(req.user!.id, 'user_delete', 'user', req.params.id, null, req.ip, req.apiKey?.id ?? null);

    res.json({ message: 'User deleted' });
  } catch (error) {
    logger.error('Error deleting user:', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
