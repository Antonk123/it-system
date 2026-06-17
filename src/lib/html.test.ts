import { describe, it, expect } from 'vitest';
import { escapeHtml } from './html';

describe('escapeHtml', () => {
  it('escapar de tecken som kan bryta ut ur textkontext', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
  });

  it('neutraliserar en XSS-payload så ingen exekverbar markup återstår', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const out = escapeHtml(payload);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapar & före övriga tecken (ingen dubbel-escape)', () => {
    expect(escapeHtml('a & b < c')).toBe('a &amp; b &lt; c');
  });

  it('lämnar vanlig text orörd', () => {
    expect(escapeHtml('Helt vanlig text 123')).toBe('Helt vanlig text 123');
  });
});
