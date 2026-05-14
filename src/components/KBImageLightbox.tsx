import { useEffect, useState, useCallback, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface KBImageLightboxProps {
  containerRef: RefObject<HTMLElement>;
  /** Re-attach handlers when this changes (e.g. when article content is replaced) */
  contentKey?: string | number | null;
}

interface ActiveImage {
  src: string;
  alt: string;
}

/**
 * Click any <img> inside the referenced container to open it in a fullscreen
 * overlay. Esc, click on backdrop, or the close button dismisses it.
 * Images already wrapped in an <a> are left alone — the link wins.
 */
export function KBImageLightbox({ containerRef, contentKey }: KBImageLightboxProps) {
  const [active, setActive] = useState<ActiveImage | null>(null);

  const close = useCallback(() => setActive(null), []);

  // Attach click handlers to all images inside the container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const images = Array.from(container.querySelectorAll('img'));
    const cleanups: Array<() => void> = [];

    for (const img of images) {
      // Skip if image is wrapped in an anchor — let the link handle the click
      if (img.closest('a')) continue;

      img.style.cursor = 'zoom-in';
      const onClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setActive({ src: img.currentSrc || img.src, alt: img.alt || '' });
      };
      img.addEventListener('click', onClick);
      cleanups.push(() => {
        img.removeEventListener('click', onClick);
        img.style.cursor = '';
      });
    }

    return () => { cleanups.forEach(fn => fn()); };
  }, [containerRef, contentKey]);

  // Esc to close + lock body scroll while open
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [active, close]);

  if (!active) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.alt || 'Förstorad bild'}
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.92)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        cursor: 'zoom-out',
      }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); close(); }}
        aria-label="Stäng förstoring"
        style={{
          position: 'absolute',
          top: '1rem',
          right: '1rem',
          width: 40,
          height: 40,
          borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
        }}
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={active.src}
        alt={active.alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          objectFit: 'contain',
          borderRadius: '0.5rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          cursor: 'default',
        }}
      />
      {active.alt && (
        <div
          style={{
            position: 'absolute',
            bottom: '1.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'rgba(255, 255, 255, 0.7)',
            fontSize: '0.875rem',
            maxWidth: '80%',
            textAlign: 'center',
            padding: '0.5rem 1rem',
            background: 'rgba(0, 0, 0, 0.4)',
            borderRadius: '0.375rem',
            backdropFilter: 'blur(8px)',
          }}
        >
          {active.alt}
        </div>
      )}
    </div>,
    document.body,
  );
}

