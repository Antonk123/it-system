const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

const blobUrlCache = new Map<string, string>();

async function fetchWithRefresh(url: string, isRetry = false): Promise<Response> {
  const token = localStorage.getItem('auth_token');
  const response = await fetch(url, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    credentials: 'include',
  });

  if (response.status === 401 && !isRetry) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      const refreshRes = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        localStorage.setItem('auth_token', data.accessToken);
        if (data.refreshToken) {
          localStorage.setItem('refreshToken', data.refreshToken);
        }
        return fetchWithRefresh(url, true);
      }
    }
  }

  return response;
}

export async function getAuthenticatedFileUrl(fileId: string): Promise<string> {
  if (blobUrlCache.has(fileId)) {
    return blobUrlCache.get(fileId)!;
  }

  const response = await fetchWithRefresh(`${API_BASE_URL}/attachments/file/${fileId}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.statusText}`);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  blobUrlCache.set(fileId, blobUrl);
  return blobUrl;
}

export async function downloadAuthenticatedFile(fileId: string, filename: string): Promise<void> {
  const blobUrl = await getAuthenticatedFileUrl(fileId);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function revokeBlobUrl(fileId: string): void {
  const blobUrl = blobUrlCache.get(fileId);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrlCache.delete(fileId);
  }
}

export function clearBlobCache(): void {
  blobUrlCache.forEach(url => URL.revokeObjectURL(url));
  blobUrlCache.clear();
}
