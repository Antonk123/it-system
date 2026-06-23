import { useEffect, useState, useCallback, useRef, RefObject } from 'react';
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Element som hade fokus innan lightboxen öppnades — fokus återställs dit vid stängning.
  const previousFocusRef = useRef<HTMLElement | null>(null);

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

  // Flytta fokus till stäng-knappen när lightboxen öppnas och återställ fokus
  // till det tidigare aktiva elementet när den stängs (om det fortfarande
  // finns kvar i DOM:en).
  useEffect(() => {
    if (!active) return;
    // Spara fokus innan vi flyttar det in i dialogen.
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    // rAF säkerställer att portalen renderas innan vi försöker fokusera
    const id = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      const prev = previousFocusRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
      }
      previousFocusRef.current = null;
    };
  }, [active]);

  // Focus-trap: Tab cyklar inom dialogen
  useEffect(() => {
    if (!active) return;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onTab);
    return () => document.removeEventListener('keydown', onTab);
  }, [active]);

  if (!active) return null;

  return createPortal(
    <div
      ref={dialogRef}
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
        ref={closeButtonRef}
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

