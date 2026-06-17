import { describe, expect, it } from 'vitest';
import { isMarkdownContent, markdownToHtml, migrateContent, cleanImportedMarkdownTables } from './contentMigration';

describe('isMarkdownContent', () => {
  it('identifierar markdown när flera typiska mönster förekommer samtidigt', () => {
    const markdown = '# Rubrik\n\n**Viktig text** med en [länk](https://example.com)';

    expect(isMarkdownContent(markdown)).toBe(true);
  });

  it('returnerar false för vanlig text eller för svaga signaler', () => {
    expect(isMarkdownContent('Vanlig text utan markdown')).toBe(false);
    expect(isMarkdownContent('Bara en *kursivering* räcker inte')).toBe(false);
  });

  it('returnerar false för html-innehåll (börjar med <)', () => {
    expect(isMarkdownContent('<p>Redan html</p>')).toBe(false);
    expect(isMarkdownContent('<table><tr><td>cell</td></tr></table>')).toBe(false);
  });

  it('identifierar rubrik + GFM-tabell som markdown (tabellseparator räcker)', () => {
    const mdWithTable = '## Blad1\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(isMarkdownContent(mdWithTable)).toBe(true);
  });

  it('identifierar enbart GFM-tabell utan andra mönster som markdown', () => {
    const onlyTable = '| Namn | Värde |\n| --- | --- |\n| Bo | 42 |';
    expect(isMarkdownContent(onlyTable)).toBe(true);
  });
});

describe('markdownToHtml', () => {
  it('konverterar vanliga markdown-element till html', () => {
    const markdown = '# Titel\n\n**Fet** och *kursiv* med [länk](https://example.com)';
    const html = markdownToHtml(markdown);

    expect(html).toContain('<h1>Titel</h1>');
    expect(html).toContain('<strong>Fet</strong>');
    expect(html).toContain('<em>kursiv</em>');
    // markdown-it renderar länken (utan target/rel — html: false)
    expect(html).toContain('<a href="https://example.com">länk</a>');
  });

  it('konverterar radbrytningar i vanlig text till html-paragrafer', () => {
    const html = markdownToHtml('Första raden\nandra raden\n\nNytt stycke');

    // markdown-it med breaks:true ger <br>\n inuti paragrafen
    expect(html).toContain('<p>Första raden');
    expect(html).toContain('<br>');
    expect(html).toContain('andra raden');
    expect(html).toContain('Nytt stycke');
  });

  it('konverterar GFM-tabell till html-tabellstruktur', () => {
    const md = '## H\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    const html = markdownToHtml(md);

    expect(html).toContain('<h2>H</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<th>B</th>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<td>2</td>');
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
    const result = migrateContent(text);

    expect(result).toContain('Rad ett');
    expect(result).toContain('Rad två');
    expect(result).toContain('Rad tre');
    expect(result).toContain('<p>');
    expect(result).toContain('<br>');
  });

  it('konverterar GFM-tabell i markdown korrekt till html', () => {
    const markdown = '## H\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    const result = migrateContent(markdown);

    expect(result).toContain('<table>');
    expect(result).toContain('<th>');
    expect(result).toContain('<td>');
  });
});

describe('cleanImportedMarkdownTables', () => {
  it('ersätter NaN-celler i tabellrader med tom sträng', () => {
    const input = '| Namn | X |\n| --- | --- |\n| Bo | NaN |';
    const result = cleanImportedMarkdownTables(input);

    // NaN-cellen ska vara borta
    expect(result).not.toMatch(/\|\s*NaN\s*\|/);
    // Strukturen ska bevaras
    expect(result).toContain('| Bo |');
    expect(result).toContain('| Namn | X |');
  });

  it('lämnar NaN i löpande text orörd', () => {
    const input = 'Värdet NaN uppstår vid division med noll.\n| A | B |\n| --- | --- |\n| 1 | NaN |';
    const result = cleanImportedMarkdownTables(input);

    // NaN i textraden ska finnas kvar
    expect(result).toContain('Värdet NaN uppstår');
    // NaN i tabellcellen ska vara borttagen
    expect(result).not.toMatch(/\|\s*NaN\s*\|/);
  });

  it('hanterar alla platshållar-varianter: null, NULL, None, undefined, nan', () => {
    const input = '| A | B | C | D | E | F |\n| --- | --- | --- | --- | --- | --- |\n| null | NULL | None | undefined | nan | ok |';
    const result = cleanImportedMarkdownTables(input);

    expect(result).not.toMatch(/\|\s*(null|NULL|None|undefined|nan)\s*\|/);
    expect(result).toContain('ok');
  });

  it('bevarar pipe-strukturen intakt', () => {
    const input = '| A | B |\n| --- | --- |\n| NaN | värde |';
    const result = cleanImportedMarkdownTables(input);
    const lines = result.split('\n');

    // Varje rad ska fortfarande ha 3 pipe-tecken
    lines.forEach(line => {
      const pipeCount = (line.match(/\|/g) || []).length;
      if (pipeCount > 0) expect(pipeCount).toBe(3);
    });
  });
});
