// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router';
import { EmbeddedTabs } from './EmbeddedTabs';

afterEach(cleanup);

const renderTabs = (path: string) =>
  render(<MemoryRouter initialEntries={[path]}><EmbeddedTabs /></MemoryRouter>);

describe('EmbeddedTabs', () => {
  it('renderar sex flikar med rätt hrefs', () => {
    renderTabs('/');
    const nav = screen.getByRole('navigation', { name: 'IT-ärenden' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(l => [l.textContent, l.getAttribute('href')])).toEqual([
      ['Översikt', '/'], ['Ärenden', '/tickets'], ['Rapporter', '/reports'],
      ['Kontakter', '/users'], ['Kunskapsbas', '/kb'], ['Inställningar', '/settings'],
    ]);
  });

  it('markerar endast aktiv flik med aria-current', () => {
    renderTabs('/companies/abc');
    const current = screen.getAllByRole('link').filter(l => l.getAttribute('aria-current') === 'page');
    expect(current.map(l => l.textContent)).toEqual(['Kontakter']);
  });

  it('Översikt är bara aktiv på exakt /', () => {
    renderTabs('/kb');
    expect(screen.getByRole('link', { name: 'Översikt' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kunskapsbas' })).toHaveAttribute('aria-current', 'page');
  });

  it('har Nytt ärende-länk till /tickets/new', () => {
    renderTabs('/');
    expect(screen.getByRole('link', { name: 'Nytt ärende (flikrad)' })).toHaveAttribute('href', '/tickets/new');
  });

  it('döljs fristående via CSS-klass och visas bara inbäddat', () => {
    renderTabs('/');
    expect(screen.getByTestId('embedded-tabs')).toHaveClass('prefabnavet-embedded-tabs');
    const css = readFileSync('src/prefabnavet-theme.css', 'utf8');
    expect(css).toContain('.prefabnavet-embedded-tabs { display: none; }');
    expect(css).toContain('html[data-prefabnavet-embedded="true"] .prefabnavet-embedded-tabs { display: flex; }');
  });
});
