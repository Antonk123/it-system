// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { getKbPortalShare, createKbPortalShare, revokeKbPortalShare } = vi.hoisted(() => ({
  getKbPortalShare: vi.fn(),
  createKbPortalShare: vi.fn(),
  revokeKbPortalShare: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { getKbPortalShare, createKbPortalShare, revokeKbPortalShare },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { KBPortalShareDialog } from './KBPortalShareDialog';
import { toast } from 'sonner';

describe('KBPortalShareDialog', () => {
  beforeEach(() => {
    getKbPortalShare.mockReset();
    createKbPortalShare.mockReset();
    revokeKbPortalShare.mockReset();
    getKbPortalShare.mockResolvedValue({ share_token: null });
    createKbPortalShare.mockResolvedValue({ share_token: 'new-token' });
    revokeKbPortalShare.mockResolvedValue({});
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    vi.stubGlobal('open', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('hämtar status först när dialogen öppnas och skapar därefter en publik länk', async () => {
    const { rerender } = render(<KBPortalShareDialog open={false} onOpenChange={vi.fn()} />);
    expect(getKbPortalShare).not.toHaveBeenCalled();

    rerender(<KBPortalShareDialog open onOpenChange={vi.fn()} />);
    expect(await screen.findByText('Skapa publik länk')).toBeTruthy();
    expect(getKbPortalShare).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Skapa publik länk' }));
    await waitFor(() => expect(createKbPortalShare).toHaveBeenCalledTimes(1));
    const publicUrl = await screen.findByDisplayValue(`${window.location.origin}/kb/public/new-token`);
    await waitFor(() => expect(publicUrl).toHaveFocus());
    expect(toast.success).toHaveBeenCalledWith('Publik länk skapad');
  });

  it('representerar aktiv länk med kopiera och öppna i ny flik', async () => {
    getKbPortalShare.mockResolvedValue({ share_token: 'active-token' });
    render(<KBPortalShareDialog open onOpenChange={vi.fn()} />);

    const publicUrl = `${window.location.origin}/kb/public/active-token`;
    const url = await screen.findByDisplayValue(publicUrl);
    expect(url.getAttribute('readonly')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Kopiera' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(publicUrl);
    });
    expect(toast.success).toHaveBeenCalledWith('Länk kopierad');

    fireEvent.click(screen.getByRole('button', { name: 'Öppna i ny flik' }));
    expect(window.open).toHaveBeenCalledWith(
      publicUrl,
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('kräver bekräftelse innan återkallning och går tillbaka till skapa-läget', async () => {
    getKbPortalShare.mockResolvedValue({ share_token: 'active-token' });
    render(<KBPortalShareDialog open onOpenChange={vi.fn()} />);
    await screen.findByDisplayValue(`${window.location.origin}/kb/public/active-token`);

    fireEvent.click(screen.getByRole('button', { name: 'Återkalla' }));
    expect(await screen.findByRole('heading', { name: 'Återkalla publik länk?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Återkalla länk' }));

    await waitFor(() => expect(revokeKbPortalShare).toHaveBeenCalledTimes(1));
    const createButton = await screen.findByRole('button', { name: 'Skapa publik länk' });
    await waitFor(() => expect(createButton).toHaveFocus());
    expect(toast.success).toHaveBeenCalledWith('Publik länk återkallad');
  });

  it('visar fel och behåller aktiv länk när återkallningen misslyckas', async () => {
    getKbPortalShare.mockResolvedValue({ share_token: 'active-token' });
    revokeKbPortalShare.mockRejectedValue(new Error('network'));
    render(<KBPortalShareDialog open onOpenChange={vi.fn()} />);
    const publicUrl = `${window.location.origin}/kb/public/active-token`;
    await screen.findByDisplayValue(publicUrl);

    fireEvent.click(screen.getByRole('button', { name: 'Återkalla' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Återkalla länk' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Kunde inte återkalla publik länk'));
    expect(screen.getByDisplayValue(publicUrl)).toBeTruthy();
  });
});
