// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useUsers } from './useUsers';

const contact = vi.hoisted(() => ({ id: 'contact-1', name: 'Anna', email: 'anna@example.com',
  company_id: 'company-1', company_name: 'Prefabmästarna', created_at: '2026-09-08T10:00:00Z' }));
vi.mock('@/lib/api', () => ({ api: { getContacts: vi.fn(async () => [contact]), createContact: vi.fn(async () => contact) } }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
afterEach(cleanup);

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return renderHook(() => useUsers(), { wrapper });
}

describe('Beställares företagskoppling', () => {
  it('bevarar bolags-ID och namn vid hämtning för formulärets automatiska företagsval', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.users).toHaveLength(1));
    expect(result.current.getUserById('contact-1')).toMatchObject({ company_id: 'company-1', company_name: 'Prefabmästarna' });
  });
  it('bevarar företagskopplingen direkt i nyskapad kontakt före återhämtning', async () => {
    const { result } = setup();
    let created;
    await act(async () => { created = await result.current.addUser({ name: 'Anna', email: 'anna@example.com', company_id: 'company-1' }); });
    expect(created).toMatchObject({ company_id: 'company-1', company_name: 'Prefabmästarna' });
  });
});
