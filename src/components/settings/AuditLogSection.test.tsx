// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const requestMock = vi.fn();

vi.mock('@/lib/api', () => ({
  api: { request: (...args: unknown[]) => requestMock(...args) },
}));

import { AuditLogSection } from './AuditLogSection';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TooltipProvider>{children}</TooltipProvider>
  </QueryClientProvider>
);

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => cleanup());

describe('AuditLogSection', () => {
  it('visar poster med användare, åtgärd och entitet efter laddning', async () => {
    requestMock.mockResolvedValueOnce({
      entries: [
        {
          id: '1',
          user_id: 'u1',
          action: 'user_delete',
          entity_type: 'user',
          entity_id: '42',
          details: 'raderade testkonto',
          ip_address: '10.0.0.1',
          created_at: '2026-06-19 08:00:00',
          user_email: 'admin@example.com',
          user_display_name: 'Admin Adminsson',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText('Admin Adminsson')).toBeTruthy());
    expect(screen.getByText('user_delete')).toBeTruthy();
    expect(screen.getByText('#42')).toBeTruthy();
    expect(screen.getByText('10.0.0.1')).toBeTruthy();
  });

  it('visar tomt-state när inga poster finns', async () => {
    requestMock.mockResolvedValueOnce({ entries: [], total: 0, limit: 50, offset: 0 });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText('Inga poster.')).toBeTruthy());
  });

  it('visar felmeddelande om anropet misslyckas', async () => {
    requestMock.mockRejectedValueOnce(new Error('Forbidden'));

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText(/Kunde inte ladda granskningsloggen/)).toBeTruthy());
  });

  it('faller tillbaka på "System" när ingen användare är kopplad till posten', async () => {
    requestMock.mockResolvedValueOnce({
      entries: [
        {
          id: '2',
          user_id: null,
          action: 'login_failure',
          entity_type: 'session',
          entity_id: null,
          details: null,
          ip_address: null,
          created_at: '2026-06-19 08:00:00',
          user_email: null,
          user_display_name: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText('System')).toBeTruthy());
  });

  it('visar API-nyckelns namn när en rad kommer från en API-nyckel (G3)', async () => {
    requestMock.mockResolvedValueOnce({
      entries: [
        {
          id: '3',
          user_id: 'u1',
          action: 'backup_download',
          entity_type: 'backup',
          entity_id: null,
          details: null,
          ip_address: '10.0.0.2',
          created_at: '2026-06-19 08:00:00',
          user_email: 'admin@example.com',
          user_display_name: 'Admin Adminsson',
          api_key_id: 'abcd1234-ef56-7890-abcd-ef1234567890',
          api_key_name: 'CI-automation',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText('Admin Adminsson')).toBeTruthy());
    expect(screen.getByText('via API-nyckel: CI-automation')).toBeTruthy();
  });

  it('faller tillbaka på förkortat id när API-nyckelns namn saknas (t.ex. raderad nyckel) (G3)', async () => {
    requestMock.mockResolvedValueOnce({
      entries: [
        {
          id: '4',
          user_id: 'u1',
          action: 'backup_download',
          entity_type: 'backup',
          entity_id: null,
          details: null,
          ip_address: null,
          created_at: '2026-06-19 08:00:00',
          user_email: 'admin@example.com',
          user_display_name: 'Admin Adminsson',
          api_key_id: 'abcd1234-ef56-7890-abcd-ef1234567890',
          api_key_name: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText('via API-nyckel #abcd1234')).toBeTruthy());
  });

  it('visar ingen API-nyckel-markering för en vanlig sessionsrad', async () => {
    requestMock.mockResolvedValueOnce({
      entries: [
        {
          id: '5',
          user_id: 'u1',
          action: 'user_delete',
          entity_type: 'user',
          entity_id: '42',
          details: null,
          ip_address: null,
          created_at: '2026-06-19 08:00:00',
          user_email: 'admin@example.com',
          user_display_name: 'Admin Adminsson',
          api_key_id: null,
          api_key_name: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText('Admin Adminsson')).toBeTruthy());
    expect(screen.queryByText(/via API-nyckel/)).toBeNull();
  });

  it('väntar med att fråga servern tills användaren pausar skrivandet i filtren', async () => {
    requestMock.mockResolvedValueOnce({ entries: [], total: 0, limit: 50, offset: 0 });
    requestMock.mockResolvedValueOnce({ entries: [], total: 0, limit: 50, offset: 0 });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    const entityTypeField = screen.getByLabelText('Entitetstyp') as HTMLInputElement;
    fireEvent.change(entityTypeField, { target: { value: 'u' } });
    fireEvent.change(entityTypeField, { target: { value: 'us' } });
    fireEvent.change(entityTypeField, { target: { value: 'user' } });

    expect(entityTypeField.value).toBe('user');
    expect(requestMock).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2), { timeout: 1000 });
    expect(requestMock.mock.calls[1][0]).toContain('entity_type=user');
  });

  it('visar intervall och paginerar utifrån serverns limit, inte en lokal konstant', async () => {
    requestMock.mockResolvedValueOnce({
      entries: [
        {
          id: '1',
          user_id: 'u1',
          action: 'user_delete',
          entity_type: 'user',
          entity_id: '42',
          details: null,
          ip_address: null,
          created_at: '2026-06-19 08:00:00',
          user_email: 'admin@example.com',
          user_display_name: 'Admin Adminsson',
        },
      ],
      total: 45,
      limit: 20,
      offset: 0,
    });
    requestMock.mockResolvedValueOnce({ entries: [], total: 45, limit: 20, offset: 20 });

    render(<AuditLogSection />, { wrapper });

    await waitFor(() => expect(screen.getByText('Visar 1–20 av 45')).toBeTruthy());

    const nextButton = screen.getByRole('button', { name: /Nästa/ }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(false);

    fireEvent.click(nextButton);

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock.mock.calls[1][0]).toContain('offset=20');
  });
});
