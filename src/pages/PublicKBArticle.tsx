import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { AlertCircle, ArrowLeft, Calendar, Folder } from 'lucide-react';
import { api, type KbPortalArticle } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { KBImageLightbox } from '@/components/KBImageLightbox';
import { PublicKBChrome } from '@/components/PublicKBChrome';
import { publicKbProseStyles, usePublicKBPageMeta } from '@/components/publicKBPresentation';

export default function PublicKBArticle() {
  const { token, articleId } = useParams<{ token: string; articleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [article, setArticle] = useState<KbPortalArticle | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  usePublicKBPageMeta(article ? `${article.title} – IT Kunskapsbas` : 'IT Kunskapsbas');

  useEffect(() => {
    if (!token || !articleId) { setError(true); setLoading(false); return; }
    let active = true;
    setLoading(true); setError(false);
    api.getKbPortalArticle(token, articleId).then((result) => active && setArticle(result)).catch(() => active && setError(true)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [token, articleId]);

  const cameFromPortal = (location.state as { fromPortal?: unknown } | null)?.fromPortal === true;
  const goBack = () => {
    if (cameFromPortal) {
      navigate(-1);
      return;
    }
    // Direktlänkar saknar en säker portalpost i historiken. Ersätt då
    // artikeln, så browserns Back inte återvänder till samma artikel.
    navigate({ pathname: `/kb/public/${token}`, search: location.search }, { replace: true });
  };

  return <PublicKBChrome><style>{publicKbProseStyles}</style><main id="huvudinnehall" className="mx-auto max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
    <button type="button" onClick={goBack} className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="h-4 w-4" />Tillbaka till artiklar</button>
    {loading ? <div className="space-y-5" aria-label="Laddar artikel"><div className="h-10 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-4 w-36 animate-pulse rounded bg-muted motion-reduce:animate-none" /><div className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" /></div> : error || !article ? <ArticleError onBack={goBack} /> : <article>
      <header className="border-b border-border pb-8"><div className="flex flex-wrap gap-2 text-sm text-muted-foreground">{article.category_name && <span className="inline-flex items-center gap-1"><Folder className="h-4 w-4" />{article.category_name}</span>}<span className="inline-flex items-center gap-1"><Calendar className="h-4 w-4" />Uppdaterad {formatDate(article.updated_at, { year: 'numeric', month: 'long', day: 'numeric' })}</span></div><h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{article.title}</h1></header>
      <div ref={contentRef} className="public-kb-prose pt-8">{article.content ? <HtmlRenderer content={article.content} /> : <p className="italic text-muted-foreground">Inget innehåll ännu.</p>}<KBImageLightbox containerRef={contentRef} contentKey={article.id} /></div>
    </article>}
  </main></PublicKBChrome>;
}

function ArticleError({ onBack }: { onBack: () => void }) { return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-7 text-center"><AlertCircle className="mx-auto h-8 w-8 text-destructive" /><h1 className="mt-3 text-xl font-semibold">Artikeln hittades inte</h1><p className="mt-2 text-sm text-muted-foreground">Länken kan vara ogiltig eller artikeln har tagits bort.</p><button type="button" onClick={onBack} className="mt-5 min-h-11 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Till kunskapsbasen</button></div>; }
