// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useActiveQueue } from './useActiveQueue';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { request } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe('useActiveQueue', () => {
  it('begär 30 aktiva ärenden sorterade på prioritet som standard', async () => {
    request.mockResolvedValue({ data: [], pagination: {} });
    const { result } = renderHook(() => useActiveQueue(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith('/tickets?status=open,in-progress,waiting&limit=30&sortBy=priority&sortDir=asc');
  });

  it('mappar listrader utan text-fält och accepterar både array- och paginerat svar', async () => {
    request.mockResolvedValue([{
      id: 't1', title: 'Skrivare', status: 'open', priority: 'high', category_id: null, requester_id: 'c1',
      company_id: null, assigned_to: null, created_at: '2026-09-08 10:00:00', updated_at: '2026-09-08 10:00:00',
      resolved_at: null, closed_at: null,
    }]);
    const { result } = renderHook(() => useActiveQueue(5), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(request).toHaveBeenCalledWith(expect.stringContaining('limit=5'));
    expect(result.current.data?.[0]).toMatchObject({ id: 't1', description: '', priority: 'high' });
  });
});
