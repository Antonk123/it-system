// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const createApiKey = vi.fn();
const deleteApiKey = vi.fn();

let apiKeysValue: {
  apiKeys: Array<{
    id: string;
    name: string;
    key_prefix: string;
    permissions: string;
    last_used_at: string | null;
    expires_at: string | null;
    created_at: string;
  }>;
  createApiKey: typeof createApiKey;
  deleteApiKey: typeof deleteApiKey;
  isCreating: boolean;
};
let authValue: { user: { id: string; email: string; role: 'admin' | 'user' } | null };

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('@/hooks/useApiKeys', () => ({ useApiKeys: () => apiKeysValue }));
vi.mock('@/hooks/useWebhooks', () => ({
  useWebhooks: () => ({
    webhooks: [],
    createWebhook: vi.fn(),
    updateWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    isCreating: false,
  }),
  useWebhookDeliveries: () => ({ deliveries: [], isLoading: false }),
}));
vi.mock('@/lib/api', () => ({
  api: {
    request: vi.fn().mockResolvedValue({
      configured: false,
      active: false,
      host: null,
      user: null,
      polling_interval: 60,
      auto_create_contact: false,
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// EmailBehaviorSection has its own coverage — stub it out here to keep this
// suite focused on the API-key section.
vi.mock('@/components/settings/EmailBehaviorSection', () => ({
  EmailBehaviorSection: () => null,
}));

import IntegrationsTab from './IntegrationsTab';
import { toast } from 'sonner';

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

// Sektionen är kollapsad by default (open=false via Collapsible) — öppna den
// innan vi letar efter formulärfälten.
const openApiKeysSection = () => {
  fireEvent.click(screen.getByText('API-nycklar'));
};

// Skapa-knappen (ikon-knapp) har ingen egen text/aria-label — den är alltid
// input-fältets närmaste syskon i DOM:en (Input renderar direkt som <input>,
// ingen wrapper), vilket är stabilare än att söka på lucide-ikonens klassnamn.
const getCreateButton = (): HTMLElement => {
  const input = screen.getByPlaceholderText('Nyckelnamn (t.ex. CI/CD)');
  return input.nextElementSibling as HTMLElement;
};

beforeEach(() => {
  createApiKey.mockReset();
  createApiKey.mockResolvedValue({ key: 'itk_live_secret' });
  deleteApiKey.mockReset();
  apiKeysValue = {
    apiKeys: [],
    createApiKey,
    deleteApiKey,
    isCreating: false,
  };
  authValue = { user: { id: 'u1', email: 'admin@example.com', role: 'admin' } };
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => cleanup());

describe('IntegrationsTab — API-nycklar admin-scope', () => {
  it('visar admin-kryssrutan för en admin-användare', () => {
    authValue = { user: { id: 'u1', email: 'admin@example.com', role: 'admin' } };
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    expect(screen.getByLabelText('Ge nyckeln admin-rättigheter')).toBeTruthy();
  });

  it('döljer admin-kryssrutan för en vanlig användare', () => {
    authValue = { user: { id: 'u2', email: 'user@example.com', role: 'user' } };
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    expect(screen.queryByLabelText('Ge nyckeln admin-rättigheter')).toBeNull();
  });

  it('skickar permissions ["read"] utan några kryssrutor ikryssade', () => {
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    fireEvent.change(screen.getByPlaceholderText('Nyckelnamn (t.ex. CI/CD)'), {
      target: { value: 'Min nyckel' },
    });
    // Klicka på skapa-knappen (ikon-knapp bredvid input)
    fireEvent.click(getCreateButton());
    expect(createApiKey).toHaveBeenCalledWith({ name: 'Min nyckel', permissions: ['read'] });
  });

  it('skickar permissions ["read","write"] med endast skriv-kryssrutan ikryssad', () => {
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    fireEvent.change(screen.getByPlaceholderText('Nyckelnamn (t.ex. CI/CD)'), {
      target: { value: 'Min nyckel' },
    });
    fireEvent.click(screen.getByLabelText('Ge nyckeln skrivrättigheter'));
    fireEvent.click(getCreateButton());
    expect(createApiKey).toHaveBeenCalledWith({ name: 'Min nyckel', permissions: ['read', 'write'] });
  });

  it('skickar permissions ["read","admin"] med endast admin-kryssrutan ikryssad (admin-användare)', () => {
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    fireEvent.change(screen.getByPlaceholderText('Nyckelnamn (t.ex. CI/CD)'), {
      target: { value: 'Backup-jobb' },
    });
    fireEvent.click(screen.getByLabelText('Ge nyckeln admin-rättigheter'));
    fireEvent.click(getCreateButton());
    expect(createApiKey).toHaveBeenCalledWith({ name: 'Backup-jobb', permissions: ['read', 'admin'] });
  });

  it('skickar permissions ["read","write","admin"] med båda kryssrutorna ikryssade', () => {
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    fireEvent.change(screen.getByPlaceholderText('Nyckelnamn (t.ex. CI/CD)'), {
      target: { value: 'Full nyckel' },
    });
    fireEvent.click(screen.getByLabelText('Ge nyckeln skrivrättigheter'));
    fireEvent.click(screen.getByLabelText('Ge nyckeln admin-rättigheter'));
    fireEvent.click(getCreateButton());
    expect(createApiKey).toHaveBeenCalledWith({
      name: 'Full nyckel',
      permissions: ['read', 'write', 'admin'],
    });
  });

  it('nollställer båda kryssrutorna efter att nyckeln skapats', async () => {
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    fireEvent.change(screen.getByPlaceholderText('Nyckelnamn (t.ex. CI/CD)'), {
      target: { value: 'Nyckel' },
    });
    fireEvent.click(screen.getByLabelText('Ge nyckeln skrivrättigheter'));
    fireEvent.click(screen.getByLabelText('Ge nyckeln admin-rättigheter'));

    const writeCheckbox = screen.getByLabelText('Ge nyckeln skrivrättigheter') as HTMLInputElement;
    const adminCheckbox = screen.getByLabelText('Ge nyckeln admin-rättigheter') as HTMLInputElement;
    expect(writeCheckbox.getAttribute('aria-checked')).toBe('true');
    expect(adminCheckbox.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(getCreateButton());

    await waitFor(() => {
      expect(writeCheckbox.getAttribute('aria-checked')).toBe('false');
      expect(adminCheckbox.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('bygger EN gemensam permissions-array oavsett om nyckeln skapas via Enter eller knappen', () => {
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    const input = screen.getByPlaceholderText('Nyckelnamn (t.ex. CI/CD)');
    fireEvent.change(input, { target: { value: 'Enter-nyckel' } });
    fireEvent.click(screen.getByLabelText('Ge nyckeln admin-rättigheter'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(createApiKey).toHaveBeenCalledWith({ name: 'Enter-nyckel', permissions: ['read', 'admin'] });
  });

  it('visar en Admin-badge på befintliga nycklar med admin-scope, utan att påverka andra nycklar', () => {
    apiKeysValue.apiKeys = [
      {
        id: '1',
        name: 'Läs-nyckel',
        key_prefix: 'abcd1234',
        permissions: JSON.stringify(['read']),
        last_used_at: null,
        expires_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        name: 'Admin-nyckel',
        key_prefix: 'efgh5678',
        permissions: JSON.stringify(['read', 'write', 'admin']),
        last_used_at: null,
        expires_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    render(<IntegrationsTab />, { wrapper });
    openApiKeysSection();
    expect(screen.getAllByText('Admin')).toHaveLength(1);
    expect(screen.getByText('Läs')).toBeTruthy();
    expect(screen.getByText('Läs + Skriv')).toBeTruthy();
  });
});
