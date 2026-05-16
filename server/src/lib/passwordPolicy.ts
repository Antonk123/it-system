/**
 * Centraliserad lösenordspolicy. Återanvänds av auth-flödet (change/reset)
 * och admin-skapande av användare i users-route.
 *
 * Krav:
 *  - minst 12 tecken
 *  - minst en versal (A-Z)
 *  - minst en gemen (a-z)
 *  - minst en siffra (0-9)
 *  - minst ett specialtecken (@$!%*?&)
 *
 * Felmeddelanden returneras på svenska för att matcha övrig API-output.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/;

export interface PasswordPolicyResult {
  ok: boolean;
  error?: string;
}

/**
 * Validerar ett lösenord mot policyn. Returnerar `{ ok: true }` om OK,
 * annars `{ ok: false, error }` med ett användarvänligt felmeddelande på svenska.
 */
export function validatePassword(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string') {
    return { ok: false, error: 'Lösenord saknas' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Lösenordet måste vara minst ${PASSWORD_MIN_LENGTH} tecken långt` };
  }
  if (!PASSWORD_REGEX.test(password)) {
    return {
      ok: false,
      error: 'Lösenordet måste innehålla minst en stor bokstav, en liten bokstav, en siffra och ett specialtecken (@$!%*?&)',
    };
  }
  return { ok: true };
}
