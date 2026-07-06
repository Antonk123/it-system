import { describe, it, expect } from 'vitest';
import { shouldApplyExternalValue } from './rich-text-sync';

describe('shouldApplyExternalValue', () => {
  // THE BUG: after posting a comment the parent clears `value` to '', but the
  // editor still holds the typed text. This external clear MUST be applied.
  it('applies an external clear after submit (value="" while editor still has text)', () => {
    expect(shouldApplyExternalValue('', '<p>Test</p>', '<p>Test</p>', false)).toBe(true);
  });

  it('applies an external clear even when the last emission was the typed text (Ctrl+Enter path)', () => {
    // Editor still focused after Ctrl+Enter; lastEmitted is the typed HTML.
    expect(shouldApplyExternalValue('', '<p>Test</p>', '<p>Test</p>', false)).toBe(true);
  });

  it('does NOT re-apply an echo of the editor\'s own emission (no caret clobber while typing)', () => {
    expect(shouldApplyExternalValue('<p>Test</p>', '<p>Test</p>', '<p>Test</p>', false)).toBe(false);
  });

  it('applies external content loaded into an empty editor (e.g. ticket description)', () => {
    expect(shouldApplyExternalValue('<p>Loaded</p>', '<p></p>', '', false)).toBe(true);
  });

  it('does nothing when value already equals the editor HTML but is not the last emission', () => {
    expect(shouldApplyExternalValue('<p>A</p>', '<p>A</p>', '<p>B</p>', false)).toBe(false);
  });

  it('never applies while a media insert is in flight', () => {
    expect(shouldApplyExternalValue('', '<p>Test</p>', '<p>Test</p>', true)).toBe(false);
  });

  it('applies a fresh external value that differs from both editor HTML and last emission', () => {
    expect(shouldApplyExternalValue('<p>New</p>', '<p>Old</p>', '<p>Old</p>', false)).toBe(true);
  });
});
