// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { getAuthenticatedFileUrl, revokeBlobUrl } = vi.hoisted(() => ({
  getAuthenticatedFileUrl: vi.fn(),
  revokeBlobUrl: vi.fn(),
}));

vi.mock('@/lib/secureFileAccess', () => ({
  getAuthenticatedFileUrl,
  revokeBlobUrl,
  downloadAuthenticatedFile: vi.fn(),
}));

import { SecureImage } from './SecureAttachment';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SecureImage — blob-cache', () => {
  it('frigör inte bilden vid avmontering, så nästa montering kan återanvända den', async () => {
    getAuthenticatedFileUrl.mockResolvedValue('blob:abc');
    const view = render(<SecureImage fileId="f1" alt="skärmdump" />);
    expect(await screen.findByAltText('skärmdump')).toHaveAttribute('src', 'blob:abc');

    view.unmount();
    expect(revokeBlobUrl).not.toHaveBeenCalled();
  });
});
