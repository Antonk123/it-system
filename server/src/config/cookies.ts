// Cookie security policy.
//
// Both the refresh-token cookie and the CSRF double-submit cookie are set with
// the `Secure` attribute. Browsers DROP `Secure` cookies on non-HTTPS origins
// (the sole exception being localhost/127.0.0.1). The shipped deployment serves
// the frontend over plain HTTP on the LAN (see docker-compose.yml: 8082:80 and
// nginx listen 80), so tying `Secure` unconditionally to NODE_ENV=production
// meant the cookies were silently never stored on real clients — e.g. the
// installed PWA on a phone reaching the server via http://<lan-ip>. Reads (GET)
// kept working, but every mutating request failed CSRF validation because the
// csrf-token cookie was missing → "kan inte spara ärendet".
//
// Resolution order:
//   1. COOKIE_SECURE explicitly set ("true"/"false") → honour it. Operators who
//      terminate TLS (HTTPS reverse proxy) set COOKIE_SECURE=true.
//   2. Otherwise fall back to the legacy NODE_ENV=production default so existing
//      HTTPS deployments that never set the flag keep Secure cookies.
//
// The shipped docker-compose.yml sets COOKIE_SECURE=false so the default
// HTTP-on-LAN deployment works out of the box.
export function cookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return process.env.NODE_ENV === 'production';
}
