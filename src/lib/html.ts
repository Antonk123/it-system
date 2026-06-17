/**
 * Escapar HTML-specialtecken i en textsträng så att den kan injiceras säkert
 * via dangerouslySetInnerHTML utan att tolkas som markup.
 *
 * Avsedd för textinnehåll (inte attributvärden). Använd den FÖRE du lägger på
 * egna betrodda taggar som <mark> — då är bara dina egna taggar riktig HTML.
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
