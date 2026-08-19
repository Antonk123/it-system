/**
 * Klipper bort citerad tråd ur ett inkommande e-postsvar.
 *
 * Ett kundsvar innehåller normalt hela den citerade konversationen under den
 * faktiska svarstexten — Outlooks `Från:/Datum:/Till:/Ämne:`-block, Gmails
 * "Den ... skrev:", `>`-prefixade rader eller vår egen mallrubrik. Allt det är
 * per definition vårt eget tidigare svar, som redan ligger som en egen
 * kommentar på ärendet, så det kan kastas utan informationsförlust.
 *
 * Körs på texten EFTER html-to-text-konverteringen: html-to-text renderar
 * <blockquote> som `> `-prefixade rader, så Gmail-/Apple-citat fångas av samma
 * radbaserade regler som Outlooks headerblock — ingen HTML-parsning behövs.
 *
 * Får ENDAST användas på svarsvägen (mail som blir kommentar på ett befintligt
 * ärende). Ett vidarebefordrat mail som skapar ett NYTT ärende måste behålla
 * hela texten — där är citatet själva innehållet.
 */

/** Rader som ensamma markerar början på ett citat. */
const QUOTE_START_PATTERNS: RegExp[] = [
  // -----Ursprungligt meddelande----- / -----Original Message-----
  /^\s*-{2,}\s*(Ursprungligt meddelande|Original Message|Vidarebefordrat meddelande|Forwarded message)/i,
  // Outlooks separatorlinje före det citerade headerblocket
  /^\s*_{10,}\s*$/,
  // "Den tis 19 aug. 2026 kl 08:36 skrev X <x@y>:" /
  // "On Tue, Aug 19, 2026 at 8:36 AM X <x@y> wrote:"
  // Kravet på en siffra i raden håller ute vanliga meningar som
  // "On Monday I wrote the following:".
  /^\s*(Den|On)\b(?=.*\d).{0,300}\b(skrev|wrote)\b.{0,200}:\s*$/i,
  // Klassiskt citatprefix (även html-to-text:s blockquote-rendering)
  /^\s*>/,
  // Vår egen mallrubrik (server/src/lib/email.ts) — räddar klienter som citerar
  // utan att lägga på ett headerblock.
  /^\s*Svar från supporten\s*$/i,
];

/** Inledningen på ett citerat headerblock ("Från: ..."). */
const FROM_HEADER = /^\s*(Från|From|Van|De|Fra)\s*:\s*\S/i;

/**
 * Övriga headerrader som måste följa strax efter "Från:" för att raden ska
 * räknas som citatstart. Utan det villkoret skulle en vanlig mening som råkar
 * börja med "From: ..." kapa hela meddelandet.
 */
const FOLLOWING_HEADER = /^\s*(Skickat|Sent|Datum|Date|Till|To|Ämne|Subject|Kopia|Cc)\s*:/i;

/** Hur många rader efter "Från:" som får genomsökas efter en följande header. */
const HEADER_LOOKAHEAD = 4;

/**
 * Rader som bara är avgränsare (streck, understreck, likhetstecken) eller tomma.
 * Klienter sätter ofta en sådan rad ovanför citatet — utan att skala bort den
 * blir "-------" allt som blir kvar av ett svar som bara är citat.
 */
const SEPARATOR_ONLY = /^[\s\-_=*]*$/;

function isQuoteStart(lines: string[], i: number): boolean {
  const line = lines[i];

  if (QUOTE_START_PATTERNS.some((pattern) => pattern.test(line))) return true;

  if (FROM_HEADER.test(line)) {
    for (let j = i + 1; j <= i + HEADER_LOOKAHEAD && j < lines.length; j++) {
      if (FOLLOWING_HEADER.test(lines[j])) return true;
    }
  }

  return false;
}

/**
 * Returnerar `body` utan den citerade tråden.
 *
 * Skyddsnät — originalet returneras oförändrat när:
 *  - citatet börjar redan på rad 0 (bottenpostat svar eller ren vidarebefordran:
 *    det finns ingen egen text att bevara, och att spara tomt vore värre), eller
 *  - allt som blir kvar är blanktecken.
 */
export function stripQuotedReply(body: string): string {
  if (!body) return body;

  const lines = body.split('\n').map((line) => line.replace(/\r$/, ''));

  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isQuoteStart(lines, i)) {
      cut = i;
      break;
    }
  }

  if (cut <= 0) return body;

  const kept = lines.slice(0, cut);
  while (kept.length > 0 && SEPARATOR_ONLY.test(kept[kept.length - 1])) kept.pop();

  const text = kept.join('\n').trim();
  return text.length > 0 ? text : body;
}
