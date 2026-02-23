/**
 * Secure file access utilities
 *
 * This module provides functions for accessing files that require authentication.
 * Since browsers don't send Authorization headers with <img> or <a> tags,
 * we need to fetch files using fetch() and create blob URLs.
 */

import { api } from './api';

// Cache for blob URLs to avoid re-fetching
const blobUrlCache = new Map<string, string>();

/**
 * Fetch a file with authentication and return a blob URL
 * @param fileId The attachment file ID
 * @returns A blob URL that can be used in <img> or <a> tags
 */
export async function getAuthenticatedFileUrl(fileId: string): Promise<string> {
  // Check cache first
  if (blobUrlCache.has(fileId)) {
    return blobUrlCache.get(fileId)!;
  }

  try {
    // Fetch file with authentication
    const token = localStorage.getItem('auth_token');
    if (!token) {
      throw new Error('No authentication token found');
    }

    const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/attachments/file/${fileId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.statusText}`);
    }

    // Create blob from response
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Cache the blob URL
    blobUrlCache.set(fileId, blobUrl);

    return blobUrl;
  } catch (error) {
    console.error('Error fetching authenticated file:', error);
    throw error;
  }
}

/**
 * Download a file with authentication
 * @param fileId The attachment file ID
 * @param filename The filename to save as
 */
export async function downloadAuthenticatedFile(fileId: string, filename: string): Promise<void> {
  try {
    const blobUrl = await getAuthenticatedFileUrl(fileId);

    // Create temporary link and trigger download
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Error downloading file:', error);
    throw error;
  }
}

/**
 * Revoke a blob URL to free memory
 * @param fileId The attachment file ID
 */
export function revokeBlobUrl(fileId: string): void {
  const blobUrl = blobUrlCache.get(fileId);
  if (blobUrl) {
    URL.revokeObjectURL(blobUrl);
    blobUrlCache.delete(fileId);
  }
}

/**
 * Clear all cached blob URLs
 */
export function clearBlobCache(): void {
  blobUrlCache.forEach(url => URL.revokeObjectURL(url));
  blobUrlCache.clear();
}
