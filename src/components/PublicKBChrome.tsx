import { type ReactNode } from 'react';
import { BookOpen } from 'lucide-react';

interface PublicKBChromeProps {
  children: ReactNode;
}

/** Delad, anonym inramning för kunskapsbasens portallänkar. */
export function PublicKBChrome({ children }: PublicKBChromeProps) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#huvudinnehall"
        className="sr-only fixed left-4 top-4 z-50 rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-sm focus:not-sr-only focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Hoppa till innehållet
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
            <BookOpen className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold tracking-tight">IT Kunskapsbas</p>
            <p className="text-xs text-muted-foreground">Guider och lösningar från IT</p>
          </div>
        </div>
      </header>
      {children}
      <footer className="mt-12 border-t border-border bg-card/60">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted-foreground sm:px-6">
          Behöver du mer hjälp? Kontakta IT-avdelningen för att logga ett ärende.
        </div>
      </footer>
    </div>
  );
}
