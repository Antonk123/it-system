import { describe, it, expect } from 'vitest';
import { sanitizeRichText, sanitizePlainText } from './htmlSanitizer.js';

describe('sanitizeRichText', () => {
  it('returnerar tom sträng för tom indata', () => {
    expect(sanitizeRichText(null)).toBe('');
    expect(sanitizeRichText(undefined)).toBe('');
    expect(sanitizeRichText('')).toBe('');
  });

  it('behåller TipTaps vanliga formatering', () => {
    const html = '<h2>Rubrik</h2><p><strong>fet</strong> <em>kursiv</em></p><ul><li>a</li></ul>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('behåller language-klasser på code-block', () => {
    const html = '<pre><code class="language-ts">const a = 1;</code></pre>';
    expect(sanitizeRichText(html)).toBe(html);
  });

  it('strippar alla andra klasser (overlay-/phishing-skydd)', () => {
    const out = sanitizeRichText('<div class="fixed inset-0 z-50 bg-white"><p class="text-xl">Logga in</p></div>');
    expect(out).not.toContain('class');
    expect(out).toContain('Logga in');
  });

  it('filtrerar bort främmande klasser men behåller language-klassen', () => {
    const out = sanitizeRichText('<code class="fixed language-js inset-0">x</code>');
    expect(out).toBe('<code class="language-js">x</code>');
  });

  it('tar bort class från span och a', () => {
    const out = sanitizeRichText('<span class="absolute">a</span><a href="https://x.se" class="fixed">l</a>');
    expect(out).not.toContain('class');
  });

  it('tar bort <script> och event-handlers', () => {
    const out = sanitizeRichText('<p onclick="alert(1)">hej</p><script>alert(1)</script><img src="https://x.se/a.png" onerror="alert(1)">');
    expect(out).not.toMatch(/script|onclick|onerror|alert/i);
  });

  it('blockerar javascript:-URL:er i länkar', () => {
    const out = sanitizeRichText('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  it('blockerar data:-URI:er på bilder', () => {
    const out = sanitizeRichText('<img src="data:image/svg+xml;base64,PHN2Zz4=">');
    expect(out).not.toContain('data:');
  });

  it('tar bort style-attribut och iframe', () => {
    const out = sanitizeRichText('<p style="position:fixed">x</p><iframe src="https://evil.se"></iframe>');
    expect(out).not.toMatch(/style|iframe/i);
  });

  it('sätter rel=noopener noreferrer på länkar', () => {
    const out = sanitizeRichText('<a href="https://x.se" target="_blank">l</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});

describe('sanitizePlainText', () => {
  it('strippar alla taggar', () => {
    expect(sanitizePlainText('<b>hej</b><script>x</script>')).toBe('hej');
  });

  it('returnerar tom sträng för tom indata', () => {
    expect(sanitizePlainText(null)).toBe('');
  });
});
