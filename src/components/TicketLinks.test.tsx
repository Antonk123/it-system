// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { TicketLinks } from './TicketLinks';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('hämtar inga kandidater förrän länksökningen har minst två tecken', async () => {
  const getTickets = vi.spyOn(api, 'getTickets').mockResolvedValue([]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TicketLinks links={[]} isLoading={false} currentTicketId="current" onAddLink={vi.fn()} onDeleteLink={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(getTickets).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Sök ärenden att länka/ }));
  fireEvent.change(screen.getByPlaceholderText('Sök ärenden...'), { target: { value: 'ab' } });

  await waitFor(() => expect(getTickets).toHaveBeenCalledWith('?page=1&limit=50&status=all&search=ab'));
  expect(getTickets).toHaveBeenCalledTimes(1);
});
