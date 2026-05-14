import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, Folder, AlertCircle, Calendar } from 'lucide-react';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { KBImageLightbox } from '@/components/KBImageLightbox';
import { api, KbArticleRow } from '@/lib/api';

const SharedKBArticle = () => {
  const { token } = useParams<{ token: string }>();
  const [article, setArticle] = useState<KbArticleRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token) { setError('Ingen länk angiven'); setIsLoading(false); return; }
    api.getPublicKbArticle(token)
      .then(setArticle)
      .catch(() => setError('Länken är ogiltig eller har tagits bort.'))
      .finally(() => setIsLoading(false));
  }, [token]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 mx-auto rounded-full border-2 border-foreground/10 border-t-primary animate-spin" />
          <p className="text-sm text-muted-foreground">Laddar artikel…</p>
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-destructive" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-1">Sidan hittades inte</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{error || 'Länken verkar vara ogiltig.'}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{proseStyles}</style>

      <div className="min-h-dvh bg-background">

        {/* Top bar */}
        <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-3xl mx-auto px-6 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <span className="text-sm font-semibold text-foreground tracking-tight">IT Kunskapsbas</span>
            </div>
            {article.category_name && (
              <span
                className="text-xs font-medium px-2.5 py-1 rounded-full border flex items-center gap-1"
                style={article.category_color ? {
                  backgroundColor: article.category_color + '22',
                  borderColor: article.category_color + '55',
                  color: article.category_color,
                } : undefined}
              >
                {!article.category_color && (
                  <span className="bg-primary/10 border-primary/30 text-primary rounded-full px-2.5 py-1 flex items-center gap-1">
                    <Folder className="w-3 h-3" />
                    {article.category_name}
                  </span>
                )}
                {article.category_color && (
                  <>
                    <Folder className="w-3 h-3" />
                    {article.category_name}
                  </>
                )}
              </span>
            )}
          </div>
        </header>

        {/* Hero */}
        <div className="bg-card/50 border-b border-border">
          <div className="max-w-3xl mx-auto px-6 pt-12 pb-10">
            <h1 className="text-3xl sm:text-4xl md:text-[2.75rem] font-bold text-foreground mb-5 leading-tight">
              {article.title}
            </h1>
            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" />
              <span>Uppdaterad {formatDate(article.updated_at)}</span>
            </div>
          </div>
        </div>

        {/* Article body */}
        <main className="max-w-3xl mx-auto px-6 py-12">
          {article.content ? (
            <div ref={contentRef} className="kb-prose">
              <HtmlRenderer content={article.content} />
              <KBImageLightbox containerRef={contentRef} contentKey={article.id} />
            </div>
          ) : (
            <p className="text-muted-foreground italic text-sm">Inget innehåll ännu.</p>
          )}
        </main>

        {/* Footer */}
        <footer className="border-t border-border bg-card/60 mt-8">
          <div className="max-w-3xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
                <BookOpen className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground leading-none">IT Kunskapsbas</p>
                <p className="text-xs text-muted-foreground mt-0.5">Internt supportsystem</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center sm:text-right leading-relaxed max-w-xs">
              Behöver du mer hjälp? Kontakta IT-avdelningen<br />
              för att logga ett ärende i systemet.
            </p>
          </div>
        </footer>

      </div>
    </>
  );
};

const proseStyles = `
  .kb-prose {
    color: hsl(var(--foreground));
    font-size: 17px;
    line-height: 1.8;
    font-family: var(--app-font-family);
  }
  .kb-prose h1, .kb-prose h2, .kb-prose h3, .kb-prose h4 {
    color: hsl(var(--foreground));
    font-weight: 700;
    margin-top: 2em;
    margin-bottom: 0.6em;
    line-height: 1.25;
    font-family: var(--app-font-family);
  }
  .kb-prose h2 { font-size: 1.6em; }
  .kb-prose h3 { font-size: 1.3em; }
  .kb-prose h4 { font-size: 1.1em; font-weight: 600; }
  .kb-prose p { margin-bottom: 1.25em; color: hsl(var(--foreground) / 0.85); }
  .kb-prose ul, .kb-prose ol { padding-left: 1.5em; margin-bottom: 1.25em; }
  .kb-prose li { margin-bottom: 0.4em; color: hsl(var(--foreground) / 0.85); }
  .kb-prose strong { color: hsl(var(--foreground)); font-weight: 600; }
  .kb-prose em { color: hsl(var(--muted-foreground)); }
  .kb-prose a { color: hsl(var(--primary)); text-decoration: underline; text-underline-offset: 3px; }
  .kb-prose a:hover { color: hsl(var(--primary) / 0.8); }
  .kb-prose code {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 0.875em;
    background: hsl(var(--muted));
    color: hsl(var(--primary));
    padding: 0.15em 0.4em;
    border-radius: 4px;
    border: 1px solid hsl(var(--border));
  }
  .kb-prose pre {
    background: hsl(var(--card));
    color: hsl(var(--card-foreground));
    padding: 1.25em 1.5em;
    border-radius: 10px;
    overflow-x: auto;
    margin-bottom: 1.5em;
    font-size: 0.875em;
    line-height: 1.6;
    border: 1px solid hsl(var(--border));
  }
  .kb-prose pre code {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .kb-prose blockquote {
    border-left: 3px solid hsl(var(--primary));
    padding-left: 1.25em;
    margin-left: 0;
    color: hsl(var(--muted-foreground));
    font-style: italic;
    margin-bottom: 1.25em;
    background: hsl(var(--primary) / 0.05);
    padding-top: 0.5em;
    padding-bottom: 0.5em;
    border-radius: 0 6px 6px 0;
  }
  .kb-prose hr {
    border: none;
    border-top: 1px solid hsl(var(--border));
    margin: 2.5em 0;
  }
  .kb-prose table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5em;
    font-size: 0.9em;
  }
  .kb-prose th {
    background: hsl(var(--muted));
    font-weight: 600;
    color: hsl(var(--foreground));
    text-align: left;
    padding: 0.65em 1em;
    border-bottom: 1px solid hsl(var(--border));
  }
  .kb-prose td {
    padding: 0.65em 1em;
    border-bottom: 1px solid hsl(var(--border) / 0.5);
    vertical-align: top;
    color: hsl(var(--foreground) / 0.85);
  }
  .kb-prose tr:last-child td { border-bottom: none; }
  .kb-prose img { border-radius: 8px; max-width: 100%; border: 1px solid hsl(var(--border)); }
`;

export default SharedKBArticle;
