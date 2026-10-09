/**
 * Centraliserad lösenordspolicy. Återanvänds av auth-flödet (change/reset)
 * och admin-skapande av användare i users-route.
 *
 * Krav (NIST 800-63B-inspirerat — längd framför fasta tecken-regler):
 *  - minst 12 tecken
 *  - högst 72 byte UTF-8 (bcrypt trunkerar tyst allt efter byte 72, så längre
 *    lösenord skulle ge falsk trygghet)
 *  - alla tecken tillåts (mellanslag, #, _, -, åäö, emoji …)
 *  - minst 3 av 4 teckenklasser (gemen, versal, siffra, övrigt) ELLER minst
 *    16 tecken — en lång lösenfras behöver inte blandade klasser.
 *
 * Felmeddelanden returneras på svenska för att matcha övrig API-output.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;
// Längd från vilken teckenklasserna inte längre krävs.
export const PASSWORD_PASSPHRASE_LENGTH = 16;
const MIN_CHARACTER_CLASSES = 3;

// bcrypt-kostnad (2^12 varv). Delas av alla ställen som hashar lösenord så att
// höjningar sker på ett ställe; passport.ts rehashar vid login om lagrad kostnad är lägre.
export const BCRYPT_ROUNDS = 12;

export interface PasswordPolicyResult {
  ok: boolean;
  error?: string;
}

function countCharacterClasses(password: string): number {
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{Ll}\p{Lu}\p{Nd}]/u];
  return classes.filter((re) => re.test(password)).length;
}

/**
 * Validerar ett lösenord mot policyn. Returnerar `{ ok: true }` om OK,
 * annars `{ ok: false, error }` med ett användarvänligt felmeddelande på svenska.
 */
export function validatePassword(password: unknown): PasswordPolicyResult {
  if (typeof password !== 'string') {
    return { ok: false, error: 'Lösenord saknas' };
  }
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Lösenordet måste vara minst ${PASSWORD_MIN_LENGTH} tecken långt` };
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return { ok: false, error: `Lösenordet får vara högst ${PASSWORD_MAX_BYTES} byte långt` };
  }
  if (length < PASSWORD_PASSPHRASE_LENGTH && countCharacterClasses(password) < MIN_CHARACTER_CLASSES) {
    return {
      ok: false,
      error: `Lösenordet måste innehålla minst tre av: liten bokstav, stor bokstav, siffra, specialtecken — eller vara minst ${PASSWORD_PASSPHRASE_LENGTH} tecken långt`,
    };
  }
  return { ok: true };
}
