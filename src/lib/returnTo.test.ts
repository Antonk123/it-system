import { describe, it, expect } from 'vitest';
import { sanitizeReturnTo } from './returnTo';

describe('sanitizeReturnTo', () => {
  it('släpper igenom en giltig intern path med query', () => {
    expect(sanitizeReturnTo('/tickets/abc?tab=2')).toBe('/tickets/abc?tab=2');
  });

  it('släpper igenom en enkel root-relativ path', () => {
    expect(sanitizeReturnTo('/kb')).toBe('/kb');
  });

  it('protocol-relative "//evil.com" → /', () => {
    expect(sanitizeReturnTo('//evil.com')).toBe('/');
  });

  it('absolut extern URL "https://evil.com" → /', () => {
    expect(sanitizeReturnTo('https://evil.com')).toBe('/');
  });

  it('backslash-variant "/\\evil.com" → /', () => {
    expect(sanitizeReturnTo('/\\evil.com')).toBe('/');
  });

  it('javascript:-URI → /', () => {
    expect(sanitizeReturnTo('javascript:alert(1)')).toBe('/');
  });

  it('tom sträng → /', () => {
    expect(sanitizeReturnTo('')).toBe('/');
  });

  it('null → /', () => {
    expect(sanitizeReturnTo(null)).toBe('/');
  });

  it('undefined → /', () => {
    expect(sanitizeReturnTo(undefined)).toBe('/');
  });

  it('objekt (icke-sträng) → /', () => {
    expect(sanitizeReturnTo({ from: '/tickets' })).toBe('/');
  });

  it('/login (self) → / (loop-skydd)', () => {
    expect(sanitizeReturnTo('/login')).toBe('/');
  });

  it('/login?returnTo=/x (nästlad param) → / (loop-skydd)', () => {
    expect(sanitizeReturnTo('/login?returnTo=/x')).toBe('/');
  });

  it('/login/ (sub-path) → / (loop-skydd)', () => {
    expect(sanitizeReturnTo('/login/foo')).toBe('/');
  });

  // Kontrolltecken-varianter — WHATWG-URL-parsern (och browsern) stripprar
  // tab/LF/CR före tolkning, så en prefix-baserad kontroll kan luras av
  // strängar som SER interna ut men normaliseras till en extern origin.
  it('LF-injektion "/\\n/evil.com" → /', () => {
    expect(sanitizeReturnTo('/\n/evil.com')).toBe('/');
  });

  it('tab + backslash "/\\t\\\\evil.com" → /', () => {
    expect(sanitizeReturnTo('/\t\\evil.com')).toBe('/');
  });

  it('CR-injektion "/\\r/evil.com" → /', () => {
    expect(sanitizeReturnTo('/\r/evil.com')).toBe('/');
  });

  it('LF-injektion kringgår INTE loop-skyddet: "/\\nlogin" → /', () => {
    expect(sanitizeReturnTo('/\nlogin')).toBe('/');
  });

  it('case-variant "/Login" → / (loop-skydd är case-okänsligt)', () => {
    expect(sanitizeReturnTo('/Login')).toBe('/');
  });

  it('/login#frag → / (loop-skydd oavsett hash)', () => {
    expect(sanitizeReturnTo('/login#frag')).toBe('/');
  });

  it('giltig path med query OCH hash bevaras oförändrad', () => {
    expect(sanitizeReturnTo('/tickets/abc?tab=2#section')).toBe('/tickets/abc?tab=2#section');
  });

  // Diskriminerande fall för origin-kontrollen: kontrolltecken-injektionen
  // normaliserar till EN ANNAN origin (evil.com) MED en icke-root pathname
  // ("/tickets/1"). Utan origin-kontrollen skulle funktionen av misstag
  // returnera den externa sidans path som om den vore vår egen (samma
  // pathname-sträng som en giltig intern rutt) — de flesta andra
  // kontrolltecken-testerna ovan råkar normalisera till pathname "/" på den
  // externa origin, vilket redan matchar fallback-värdet och därför INTE
  // avslöjar om origin-kontrollen saknas.
  it('kontrolltecken-injektion till extern host med icke-root path → / (inte den externa pathen)', () => {
    expect(sanitizeReturnTo('/\n/evil.com/tickets/1')).toBe('/');
  });

  // Dot-segment behåller VÅR origin (origin-kontrollen godkänner dem) men
  // normaliseras till en protocol-relativ pathname — returvärdet får aldrig
  // börja med "//", oavsett att react-router råkar kollapsa dubbelslash.
  it('"/.//evil.com" → / (dot-segment ger protocol-relativ pathname)', () => {
    expect(sanitizeReturnTo('/.//evil.com')).toBe('/');
  });

  it('"/foo/..//evil.com" → / (samma sak via ..-segment)', () => {
    expect(sanitizeReturnTo('/foo/..//evil.com')).toBe('/');
  });

  // Pinnar normaliseringssteget: en "förenkling" tillbaka till `return raw`
  // skulle tyst återinföra dot-segment-bypassen av loop-skyddet.
  it('"/foo/../login" → / (loop-skyddet går inte att kringgå med ..)', () => {
    expect(sanitizeReturnTo('/foo/../login')).toBe('/');
  });
});
