// Pure validation logic for startup secrets (JWT_SECRET, CSRF_SECRET, ...).
//
// CRITICAL invariant: secrets must be present and >= MIN_SECRET_LENGTH chars.
// A short secret is brute-forceable (e.g. HS256 token forging, CSRF double-submit
// signing). We fail CLOSED by default. The relaxation for short secrets requires
// TWO explicit conditions — opt-in flag AND a whitelisted non-prod NODE_ENV
// ('development'|'test', never "!= production") — so neither a misconfigured
// prod (NODE_ENV unset) nor ALLOW_WEAK_SECRETS=1 leaking into prod can fail open.
//
// This module contains NO process.exit() and NO logging — it is a pure function
// so the invariant is unit-testable. Callers (passport.ts, app.ts) are
// responsible for exiting the process / logging based on the result.

export const MIN_SECRET_LENGTH = 32;

export interface SecretValidationEnv {
  NODE_ENV?: string;
  ALLOW_WEAK_SECRETS?: string;
}

export type SecretValidationResult =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

/**
 * Validates a startup secret (e.g. JWT_SECRET, CSRF_SECRET) against the
 * project's fail-closed policy. Pure function — no I/O, no process.exit.
 *
 * @param name Human-readable secret name, used in messages (e.g. "JWT_SECRET").
 * @param value The secret value read from the environment (may be undefined/empty).
 * @param env The environment flags that gate the weak-secret relaxation.
 */
export function validateSecret(
  name: string,
  value: string | undefined,
  env: SecretValidationEnv
): SecretValidationResult {
  if (!value) {
    return {
      ok: false,
      reason: `${name} environment variable is not set. Please set ${name} to a strong random value.`,
    };
  }

  if (value.length < MIN_SECRET_LENGTH) {
    const allowWeak =
      env.ALLOW_WEAK_SECRETS === '1' &&
      (env.NODE_ENV === 'development' || env.NODE_ENV === 'test');

    if (allowWeak) {
      return {
        ok: true,
        warning: `${name} is short (${value.length} chars) — allowed only because ALLOW_WEAK_SECRETS=1 in NODE_ENV=${env.NODE_ENV}. Recommend at least ${MIN_SECRET_LENGTH}.`,
      };
    }

    return {
      ok: false,
      reason: `${name} is too short (${value.length} chars) — must be at least ${MIN_SECRET_LENGTH}. (Overridable only with NODE_ENV=development|test + ALLOW_WEAK_SECRETS=1.)`,
    };
  }

  return { ok: true };
}
