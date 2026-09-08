// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { TicketViewNavigation } from './TicketViewNavigation';
import { BottomTabBar } from './BottomTabBar';
import { RouteBreadcrumbs } from './RouteBreadcrumbs';

afterEach(cleanup);

function NavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <TicketViewNavigation />
    <BottomTabBar />
    <RouteBreadcrumbs />
    <output aria-label="Aktuell adress">{location.pathname}{location.search}</output>
    <button onClick={() => navigate(-1)}>Bakåt</button>
  </>;
}

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><NavigationHarness /></MemoryRouter>);
}

describe('Gemensamma ärendevyer', () => {
  it.each([
    ['/my-tickets', 'Mina'], ['/tickets', 'Alla'], ['/archive', 'Avslutade'],
  ])('markerar gammal direktlänk %s i vyval, mobilmeny och brödsmulor', (path, label) => {
    renderAt(`${path}?search=skrivare`);
    const views = within(screen.getByRole('navigation', { name: 'Ärendevyer' }));
    expect(views.getAllByRole('link')).toHaveLength(3);
    expect(views.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
    const mobile = within(screen.getByRole('navigation', { name: 'Huvudnavigation' }));
    expect(mobile.getByRole('link', { name: 'Ärenden' })).toHaveAttribute('aria-current', 'page');
    const crumbs = within(screen.getByRole('navigation', { name: 'Brödsmulor' }));
    expect(crumbs.getByText(label)).toHaveAttribute('aria-current', 'page');
    expect(crumbs.getByRole('link', { name: 'Ärenden' })).toHaveAttribute('href', '/tickets');
  });

  it('behåller aktuella filter vid klick på aktiv vy och vid bakåtnavigering', () => {
    const initial = '/archive?dateFrom=2026-01-01&dateField=closed_at&search=skrivare';
    renderAt(initial);
    const views = within(screen.getByRole('navigation', { name: 'Ärendevyer' }));
    expect(views.getByRole('link', { name: 'Avslutade' })).toHaveAttribute('href', initial);
    fireEvent.click(views.getByRole('link', { name: 'Mina' }));
    expect(screen.getByLabelText('Aktuell adress')).toHaveTextContent('/my-tickets');
    fireEvent.click(screen.getByRole('button', { name: 'Bakåt' }));
    expect(screen.getByLabelText('Aktuell adress')).toHaveTextContent(initial);
  });

  it('markerar bara Nytt i mobilmenyn på /tickets/new', () => {
    renderAt('/tickets/new');
    const mobile = within(screen.getByRole('navigation', { name: 'Huvudnavigation' }));
    expect(mobile.getByRole('link', { name: 'Nytt' })).toHaveAttribute('aria-current', 'page');
    expect(mobile.getByRole('link', { name: 'Ärenden' })).not.toHaveAttribute('aria-current');
  });
});
