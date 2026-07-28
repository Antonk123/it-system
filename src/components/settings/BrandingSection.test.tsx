// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

let authValue: { user: { id: string; email: string; role: 'admin' | 'user' } | null };
let brandingValue: { logoUrl: string | null };

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => authValue }));
vi.mock('@/hooks/useBranding', () => ({
  useBranding: () => brandingValue,
  brandingKeys: { all: ['branding'] },
}));
vi.mock('@/lib/api', () => ({
  api: {
    uploadBrandingLogo: vi.fn(),
    deleteBrandingLogo: vi.fn(),
  },
}));
vi.mock('@/assets/logo-default.svg', () => ({ default: '/mock/logo-default.svg' }));

import { api } from '@/lib/api';
import { BrandingSection } from './BrandingSection';

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  authValue = { user: { id: 'u1', email: 'admin@b.c', role: 'admin' } };
  brandingValue = { logoUrl: null };
});

afterEach(cleanup);

describe('BrandingSection', () => {
  it('döljs för icke-admin', () => {
    authValue = { user: { id: 'u2', email: 'user@b.c', role: 'user' } };
    const { container } = renderWithClient(<BrandingSection />);
    expect(container.firstChild).toBeNull();
  });

  it('visas för admin med filväljare', () => {
    renderWithClient(<BrandingSection />);
    expect(screen.getByLabelText('Ladda upp logotyp')).toBeInTheDocument();
  });

  it('döljer "Återställ till standard" när ingen egen logotyp finns', () => {
    renderWithClient(<BrandingSection />);
    expect(screen.queryByRole('button', { name: /Återställ till standard/i })).toBeNull();
  });

  it('visar "Återställ till standard" när en egen logotyp finns', () => {
    brandingValue = { logoUrl: '/api/public/branding/logo?v=1' };
    renderWithClient(<BrandingSection />);
    expect(screen.getByRole('button', { name: /Återställ till standard/i })).toBeInTheDocument();
  });

  it('avvisar för stor fil på klientsidan utan att anropa API:et', () => {
    renderWithClient(<BrandingSection />);
    const input = screen.getByLabelText('Ladda upp logotyp') as HTMLInputElement;
    const bigFile = new File([new Uint8Array(1024 * 1024 + 1)], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [bigFile] } });
    expect(api.uploadBrandingLogo).not.toHaveBeenCalled();
  });

  it('avvisar fel filtyp (SVG) på klientsidan utan att anropa API:et', () => {
    renderWithClient(<BrandingSection />);
    const input = screen.getByLabelText('Ladda upp logotyp') as HTMLInputElement;
    const svgFile = new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' });
    fireEvent.change(input, { target: { files: [svgFile] } });
    expect(api.uploadBrandingLogo).not.toHaveBeenCalled();
  });

  it('anropar uppladdning för en giltig fil', async () => {
    (api.uploadBrandingLogo as ReturnType<typeof vi.fn>).mockResolvedValue({ logoUrl: '/api/public/branding/logo?v=2' });
    renderWithClient(<BrandingSection />);
    const input = screen.getByLabelText('Ladda upp logotyp') as HTMLInputElement;
    const file = new File(['abc'], 'logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(api.uploadBrandingLogo).toHaveBeenCalledWith(file));
  });
});
