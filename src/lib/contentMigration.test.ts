import { describe, expect, it } from 'vitest';
import { isMarkdownContent, markdownToHtml, migrateContent } from './contentMigration';

describe('isMarkdownContent', () => {
  it('identifierar markdown när flera typiska mönster förekommer samtidigt', () => {
    const markdown = '# Rubrik\n\n**Viktig text** med en [länk](https://example.com)';

    expect(isMarkdownContent(markdown)).toBe(true);
  });

  it('returnerar false för vanlig text eller för svaga signaler', () => {
    expect(isMarkdownContent('Vanlig text utan markdown')).toBe(false);
    expect(isMarkdownContent('Bara en *kursivering* räcker inte')).toBe(false);
  });
});

describe('markdownToHtml', () => {
  it('konverterar vanliga markdown-element till html', () => {
    const markdown = '# Titel\n\n**Fet** och *kursiv* med [länk](https://example.com)';
    const html = markdownToHtml(markdown);

    expect(html).toContain('<h1>Titel</h1>');
    expect(html).toContain('<strong>Fet</strong>');
    expect(html).toContain('<em>kursiv</em>');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">länk</a>');
  });

  it('konverterar radbrytningar i vanlig text till html-paragrafer', () => {
    const html = markdownToHtml('Första raden\nandra raden\n\nNytt stycke');

    expect(html).toBe('<p>Första raden<br>andra raden</p><p>Nytt stycke</p>');
  });
});

describe('migrateContent', () => {
  it('returnerar befintlig html oförändrad', () => {
    const html = '<p>Redan html</p>';

    expect(migrateContent(html)).toBe(html);
  });

  it('migrerar markdown till html automatiskt', () => {
    const markdown = '## Sektion\n\n**Innehåll**';
    const result = migrateContent(markdown);

    expect(result).toContain('<h2>Sektion</h2>');
    expect(result).toContain('<strong>Innehåll</strong>');
  });

  it('omsluter vanlig text i paragraf-taggar och behåller radbrytningar', () => {
    const text = 'Rad ett\nRad två\n\nRad tre';

    expect(migrateContent(text)).toBe('<p>Rad ett<br>Rad två</p><p>Rad tre</p>');
  });
});
