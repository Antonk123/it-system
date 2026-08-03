// Sanerar ett "returnTo"-värde (från router-state eller ?returnTo=-queryparam)
// till en säker, intern path — open-redirect-skydd. Ren funktion, ingen
// router-import: konsumeras både av App.tsx (PublicRoute) och Login.tsx.
//
// Regler (i ordning):
//  - måste vara en sträng som börjar med "/" (utesluter absoluta URL:er,
//    protocol-relative "//host", "javascript:"-URI:er, icke-strängar m.m.)
//  - får inte börja med "//" eller "/\" (browsern tolkar båda som
//    protocol-relative → öppen redirect till en extern host)
//  - får inte peka på /login (self eller med query/path under /login) —
//    loop-skydd mot att landa tillbaka på inloggningssidan efter inloggning
// Allt annat faller tillbaka till "/".
export function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  if (!raw.startsWith('/')) return '/';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (raw === '/login' || raw.startsWith('/login?') || raw.startsWith('/login/')) return '/';
  return raw;
}
