import { describe, expect, it } from 'vitest';
import { hasDraftContent } from './prefillFromQuery';

describe('hasDraftContent', () => {
  it('räknar inte tom editor-markup som innehåll', () => {
    expect(hasDraftContent({ title: '', description: '<p></p>' })).toBe(false);
    expect(hasDraftContent({ description: '<p>&nbsp;</p><p><br></p>' })).toBe(false);
    expect(hasDraftContent({ title: '   ' })).toBe(false);
  });
  it('räknar text, beställare, anteckningar och lösning', () => {
    expect(hasDraftContent({ title: 'x' })).toBe(true);
    expect(hasDraftContent({ description: '<p>hej</p>' })).toBe(true);
    expect(hasDraftContent({ requesterId: 'u1' })).toBe(true);
    expect(hasDraftContent({ notes: '<p>n</p>' })).toBe(true);
    expect(hasDraftContent({ solution: '<p>s</p>' })).toBe(true);
  });
  it('tål konstiga värden', () => {
    expect(hasDraftContent(null)).toBe(false);
    expect(hasDraftContent('text')).toBe(false);
    expect(hasDraftContent({ title: 5 })).toBe(false);
  });
});
