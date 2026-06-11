import { describe, it, expect } from 'vitest';
import { stripHtml } from './htmlUtils.js';

// htmlUtils.ts has no external dependencies — pure unit tests.

describe('stripHtml', () => {
  // ── Tag removal ────────────────────────────────────────────────────────

  it('strips a single HTML tag', () => {
    expect(stripHtml('<b>bold</b>')).toBe('bold');
  });

  it('strips multiple HTML tags', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('strips self-closing tags', () => {
    expect(stripHtml('line1<br/>line2')).toBe('line1 line2');
  });

  it('strips tags with attributes', () => {
    expect(stripHtml('<a href="https://example.com">click here</a>')).toBe('click here');
  });

  it('strips script tags (content stays — only tags removed)', () => {
    // The implementation removes tags, not their content
    expect(stripHtml('<script>alert(1)</script>')).toBe('alert(1)');
  });

  it('returns empty string for input that is only tags', () => {
    expect(stripHtml('<br/>')).toBe('');
  });

  // ── HTML entity decoding ────────────────────────────────────────────────

  it('replaces &nbsp; with a space', () => {
    const result = stripHtml('foo&nbsp;bar');
    expect(result).toBe('foo bar');
  });

  it('decodes &amp;', () => {
    expect(stripHtml('fish &amp; chips')).toBe('fish & chips');
  });

  it('decodes &lt; and &gt;', () => {
    expect(stripHtml('1 &lt; 2 &amp;&amp; 3 &gt; 2')).toBe('1 < 2 && 3 > 2');
  });

  // ── Whitespace normalisation ───────────────────────────────────────────

  it('collapses multiple spaces into one', () => {
    expect(stripHtml('foo   bar')).toBe('foo bar');
  });

  it('collapses space introduced by tag removal', () => {
    // <p> → ' ', text, </p> → ' ' — should become single spaces
    const result = stripHtml('<p>  hello  </p>');
    expect(result).toBe('hello');
  });

  it('trims leading and trailing whitespace', () => {
    expect(stripHtml('  hello world  ')).toBe('hello world');
  });

  it('trims whitespace after stripping tags at edges', () => {
    expect(stripHtml('<div>  text  </div>')).toBe('text');
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('returns plain text unchanged (modulo trim)', () => {
    expect(stripHtml('hello world')).toBe('hello world');
  });

  it('handles deeply nested tags', () => {
    expect(stripHtml('<div><p><span>deep</span></p></div>')).toBe('deep');
  });

  it('handles HTML with newlines inside tags gracefully', () => {
    const html = '<p\n  class="foo">text</p>';
    expect(stripHtml(html)).toBe('text');
  });
});
