import { api } from './api';

const blobUrlCache = new Map<string, string>();

export async function getAuthenticatedFileUrl(fileId: string): Promise<string> {
  if (blobUrlCache.has(fileId)) {
    return blobUrlCache.get(fileId)!;
  }

  const blob = await api.requestBlob(`/attachments/file/${fileId}`);
  const blobUrl = URL.createObjectURL(blob);
  blobUrlCache.set(fileId, blobUrl);
  return blobUrl;
}

export async function downloadAuthenticatedFile(fileId: string, filename: string): Promise<void> {
  // Always do a fresh fetch for downloads to avoid stale/empty blob cache issues
  const blob = await api.requestBlob(`/attachments/file/${fileId}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function revokeBlobUrl(fileId: string): void {
  const blobUrl = blobUrlCache.get(fileId);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrlCache.delete(fileId);
  }
}
