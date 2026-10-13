import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { getAuthenticatedFileUrl } from './secureFileAccess';

export interface InlineImage { id: string; file: File }
export interface TicketSubmission { attachments?: File[]; images?: InlineImage[]; idempotencyKey?: string }
export interface ImageAdapter { add: (file: File) => Promise<string>; resolve?: (src: string) => Promise<string> }
export const ImageAdapterContext = createContext<ImageAdapter | null>(null);
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.gif,.webp';
export const imageSource = (id: string) => `/api/attachments/file/${id}`;
export const imageId = (src: string) => /^\/api\/attachments\/file\/([\da-f-]{36})$/i.exec(src)?.[1];

export function checkImage(file: File): void {
  const formats: Record<string, string[]> = { 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/gif': ['gif'], 'image/webp': ['webp'] };
  if (!formats[file.type]?.includes(file.name.split('.').pop()?.toLowerCase() || '')) throw new Error('Välj en PNG-, JPEG-, GIF- eller WebP-bild.');
  if (!file.size) throw new Error('Bilden är tom.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Bilden får vara högst 10 MB.');
}

// Ported from Navet image-intake.js: inspect original bytes, never recompress.
export async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    }
  } catch { /* use the same object URL fallback as Navet */ }
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const finish = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 }); };
    image.onload = finish; image.onerror = finish; image.src = url;
  });
}

export function useTicketImages(anonymous = false) {
  const anonymousRef = useRef(anonymous); anonymousRef.current = anonymous;
  const [images, setImages] = useState<InlineImage[]>([]);
  const imagesRef = useRef(images); imagesRef.current = images;
  const urls = useRef(new Map<string, string>());
  useEffect(() => () => { for (const url of urls.current.values()) URL.revokeObjectURL(url); }, []);
  const adapter = useMemo<ImageAdapter>(() => ({
    add: async file => {
      checkImage(file);
      const current = imagesRef.current;
      if (current.length >= 10 || current.reduce((sum, item) => sum + item.file.size, file.size) > 25 * 1024 * 1024) throw new Error('Högst 10 bilder och 25 MB sammanlagt.');
      const entry = { id: crypto.randomUUID(), file };
      imagesRef.current = [...current, entry];
      setImages(imagesRef.current);
      return imageSource(entry.id);
    },
    resolve: async src => {
      const id = imageId(src);
      if (!id) return src;
      const pending = imagesRef.current.find(item => item.id === id);
      if (!pending) {
        if (anonymousRef.current) throw new Error('Bilden saknas i utkastet. Infoga den igen.');
        return getAuthenticatedFileUrl(id);
      }
      if (!urls.current.has(id)) urls.current.set(id, URL.createObjectURL(pending.file));
      return urls.current.get(id)!;
    },
  }), []);
  const referenced = useCallback((content: unknown) => {
    const serialized = JSON.stringify(content);
    return imagesRef.current.filter(item => serialized.includes(imageSource(item.id)));
  }, []);
  return useMemo(() => ({ images, setImages, adapter, referenced }), [images, adapter, referenced]);
}

export function useImageSource(src: string): string | undefined {
  const adapter = useContext(ImageAdapterContext);
  const [resolved, setResolved] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!imageId(src)) return;
    let live = true;
    const request = adapter?.resolve ? adapter.resolve(src) : getAuthenticatedFileUrl(imageId(src)!);
    void request.then(url => { if (live) setResolved({ src, url }); }).catch(() => { /* broken image, never discard editor content */ });
    return () => { live = false; };
  }, [src, adapter]);
  return imageId(src) ? (resolved?.src === src ? resolved.url : undefined) : src;
}

export const kbImageAdapter: ImageAdapter = { add: async file => { checkImage(file); return (await api.uploadKbImage(file)).url; } };
export const ticketImageAdapter = (ticketId: string): ImageAdapter => ({ add: async file => {
  checkImage(file);
  const attachment = await api.uploadInlineTicketImage(ticketId, file);
  return imageSource(attachment.id);
} });
