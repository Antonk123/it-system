/**
 * Bygger ett Content-Disposition-huvud för nedladdning (alltid `attachment`,
 * aldrig inline). Filnamnet trunkeras till 200 tecken, ASCII-fallbacken
 * (`filename=`) ersätter allt utanför säkra ASCII-tecken samt citattecken,
 * semikolon och backslash, och `filename*` bär det riktiga namnet RFC
 * 5987-kodat så att åäö och specialtecken överlever i moderna klienter.
 */
export function attachmentDisposition(filename: string): string {
  // Trunkera på kodpunkter: en klippning mitt i ett surrogatpar får inte kasta i encodeURIComponent.
  const truncated = Array.from(filename).slice(0, 200).join('');
  const asciiFallback = truncated
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/[";\\]/g, '_');
  // encodeURIComponent lämnar ' ( ) * oescapade, vilket RFC 5987 inte tillåter.
  const encoded = encodeURIComponent(truncated)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
