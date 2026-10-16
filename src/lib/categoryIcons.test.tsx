// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CATEGORY_ICONS, CategoryIcon, CategoryIconPicker, isCategoryIconKey } from './categoryIcons';

describe('categoryIcons', () => {
  it('har alla 17 unika nycklar i rätt ordning', () => {
    const keys = CATEGORY_ICONS.map((i) => i.key);
    expect(keys).toEqual([
      'default', 'document', 'spreadsheet', 'people', 'project', 'production', 'chart', 'finance', 'safety',
      'quality', 'calendar', 'time', 'checklist', 'folder', 'support', 'education', 'grid',
    ]);
    expect(new Set(keys).size).toBe(17);
    expect(isCategoryIconKey('grid')).toBe(true);
    expect(isCategoryIconKey('nope')).toBe(false);
  });

  it('CategoryIcon renderar inget för okänd/null nyckel', () => {
    const { container } = render(
      <>
        <CategoryIcon icon="nope" />
        <CategoryIcon icon={null} />
        <CategoryIcon />
      </>
    );
    expect(container.innerHTML).toBe('');
  });

  it('CategoryIcon renderar en aria-hidden svg för känd nyckel', () => {
    const { container } = render(<CategoryIcon icon="document" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('tile-varianten är aria-hidden', () => {
    const { container } = render(<CategoryIcon icon="time" variant="tile" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('väljaren har aria-label "Kategoriikon"', () => {
    render(<CategoryIconPicker value={null} onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Kategoriikon' })).toBeTruthy();
  });

  it('väljaren använder angiven label som aria-label', () => {
    render(<CategoryIconPicker value={null} onChange={() => {}} label="Ikon för ny kategori" />);
    expect(screen.getByRole('combobox', { name: 'Ikon för ny kategori' })).toBeTruthy();
  });
});
