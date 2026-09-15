import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';

function MapContent() {
  const [params] = useSearchParams();
  const embedded = params.get('embed') === '1';
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(false);
    setHtml(null);
    api.requestBlob('/architecture-map', { signal: controller.signal })
      .then(async (blob) => {
        if (!blob.type.startsWith('text/html')) throw new Error('Invalid map response');
        const content = await blob.text();
        if (!controller.signal.aborted) setHtml(content);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt]);

  return (
    <main className="flex h-dvh flex-col bg-background">
      {!embedded && (
        <div className="flex shrink-0 items-center border-b px-4">
          <Link to="/settings" className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Till inställningar
          </Link>
        </div>
      )}
      {error ? (
        <div className="m-auto space-y-4 p-6 text-center" role="alert">
          <p>Kartan kunde inte laddas. Kontrollera anslutningen och att du har administratörsbehörighet.</p>
          <Button onClick={() => setAttempt((value) => value + 1)}>Försök igen</Button>
        </div>
      ) : html === null ? (
        <div className="m-auto flex items-center gap-2 p-6" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Laddar arkitekturkartan…
        </div>
      ) : (
        <iframe
          title="IT-Ticket – arkitekturkarta"
          name={embedded ? 'architecture-map-embed' : 'architecture-map'}
          srcDoc={html}
          // Trusted, administrator-only artifact from our backend. Same-origin
          // preserves the viewer's local notes; forms never call the backend.
          sandbox="allow-scripts allow-same-origin allow-downloads"
          className="min-h-0 w-full flex-1 border-0"
        />
      )}
    </main>
  );
}

export default function ArchitectureMap() {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return <main className="p-6"><h1 className="text-xl font-semibold">Administratörsbehörighet krävs</h1><Link className="inline-flex min-h-11 items-center underline" to="/settings">Till inställningar</Link></main>;
  }
  return <MapContent />;
}
