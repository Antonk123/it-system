// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BackupFilesList } from './BackupFilesList';

const mocks = vi.hoisted(() => ({
  getBackupFiles: vi.fn(),
  downloadBackupFile: vi.fn(),
  downloadBlob: vi.fn(),
  toast: { error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: { getBackupFiles: mocks.getBackupFiles, downloadBackupFile: mocks.downloadBackupFile },
  downloadBlob: mocks.downloadBlob,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

function setup() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BackupFilesList />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBackupFiles.mockResolvedValue([
    { name: 'backup-2026-09-08.zip', sizeBytes: 5 * 1024 * 1024, modifiedAt: '2026-09-08T02:00:00Z' },
  ]);
});
afterEach(cleanup);

describe('BackupFilesList', () => {
  it('listar sparade backuper med storlek och laddar ned vald fil', async () => {
    const blob = new Blob(['zip']);
    mocks.downloadBackupFile.mockResolvedValue(blob);
    setup();

    expect(await screen.findByText('backup-2026-09-08.zip')).toBeInTheDocument();
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ladda ned backup-2026-09-08.zip' }));

    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(blob, 'backup-2026-09-08.zip'));
    expect(mocks.downloadBackupFile).toHaveBeenCalledWith('backup-2026-09-08.zip');
  });

  it('visar ett fel när nedladdningen misslyckas', async () => {
    mocks.downloadBackupFile.mockRejectedValue(new Error('403'));
    setup();

    fireEvent.click(await screen.findByRole('button', { name: 'Ladda ned backup-2026-09-08.zip' }));

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(mocks.downloadBlob).not.toHaveBeenCalled();
  });

  it('visar tomt läge när inga backuper finns', async () => {
    mocks.getBackupFiles.mockResolvedValue([]);
    setup();

    expect(await screen.findByText('Inga sparade backuper ännu.')).toBeInTheDocument();
  });
});
