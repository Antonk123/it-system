// Sanerar ett "returnTo"-värde (från router-state eller ?returnTo=-queryparam)
// till en säker, intern path — open-redirect-skydd. Ren funktion, ingen
// router-import: konsumeras både av App.tsx (PublicRoute) och Login.tsx.
//
// Mekanism: låt URL-parsern normalisera i stället för att gissa vad den gör.
// WHATWG-URL-parsern (samma parser browsern använder) stripprar bl.a.
// tab/LF/CR ur input INNAN den tolkar strängen — ett rent prefix-baserat
// skydd (startsWith("//") m.fl.) kan därför luras av t.ex. "/\n/evil.com",
// som ser ofarligt ut för en naiv strängkontroll men normaliseras av
// browsern till en extern origin. Genom att köra samma parser här och sedan
// kräva att resultatet fortfarande har vår interna dummy-origin fångas alla
// sådana varianter i ETT svep, utan att vi behöver känna till dem alla:
//  - new URL(raw, INTERNAL_BASE) — parsar raw relativt en fejk-origin.
//  - url.origin !== INTERNAL_BASE → raw normaliserade till en ANNAN origin
//    ("//evil.com", "/\evil.com", kontrolltecken-varianter, etc) → "/".
//  - pathname (utan query/hash) jämförs case-okänsligt mot /login och
//    /login/* — loop-skydd mot att landa tillbaka på inloggningssidan efter
//    inloggning. React Router matchar rutter case-okänsligt, så skyddet
//    måste göra det också (annars slinker "/Login" igenom).
// Allt annat faller tillbaka till "/".
//
// Origin-kontrollen räcker inte ensam: en path-absolut input med dot-segment
// ("/.//evil.com", "/foo/..//evil.com") behåller vår origin men normaliseras
// till pathname "//evil.com", vilket är protocol-relativt om det senare tolkas
// som en URL. React Router kollapsar dubbelslash innan navigering, men den
// garantin tillhör biblioteket — inte oss. Vi avvisar därför sådana pathnames
// själva, så att returvärdet är säkert oavsett vem som konsumerar det.
const INTERNAL_BASE = 'https://internal.invalid';

export function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(raw, INTERNAL_BASE);
  } catch {
    return '/';
  }
  if (url.origin !== INTERNAL_BASE) return '/';
  if (url.pathname.startsWith('//')) return '/';
  const pathLower = url.pathname.toLowerCase();
  if (pathLower === '/login' || pathLower.startsWith('/login/')) return '/';
  return url.pathname + url.search + url.hash;
}
