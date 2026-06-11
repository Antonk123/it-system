import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Folder, Calendar, Share2, Link as LinkIcon, X, Printer, CheckCircle, Link2 } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { KBImageLightbox } from '@/components/KBImageLightbox';
import { api, KbArticleRow } from '@/lib/api';
import { useKbArticle } from '@/hooks/useKbArticle';
import { addRecentlyViewedKB } from '@/lib/recentlyViewed';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';

type TocItem = { id: string; text: string; level: number };

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const KBArticleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: kbData, isLoading, isError } = useKbArticle(id);

  // Local mutable state derived from the query (mutations update these in-place)
  const [article, setArticle] = useState<KbArticleRow | null>(null);
  const [shareToken, setShareToken] = useState<string | null>(null);

  const [isDeleting, setIsDeleting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [isTogglingShare, setIsTogglingShare] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  // Seed local state once data arrives
  useEffect(() => {
    if (!kbData) return;
    setArticle(kbData.article);
    setShareToken(kbData.shareToken);
    if (kbData.article?.id && kbData.article?.title) {
      addRecentlyViewedKB(String(kbData.article.id), kbData.article.title);
    }
  }, [kbData]);

  // Navigate away if the query fails (same behaviour as before)
  useEffect(() => {
    if (isError) {
      toast.error('Artikeln hittades inte');
      navigate('/kb');
    }
  }, [isError, navigate]);

  const linkedTickets = kbData?.linkedTickets ?? [];
  const crossRefs = kbData?.crossRefs ?? [];

  useEffect(() => {
    if (!contentRef.current || !article?.content) return;
    // Defer to next tick so the DOM has committed after content render
    const timer = setTimeout(() => {
      if (!contentRef.current) return;
      const headings = contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
      const usedSlugs = new Set<string>();
      const items: TocItem[] = [];
      headings.forEach((el) => {
        const text = el.textContent?.trim() ?? '';
        if (!text) return;
        let slug = slugify(text);
        if (usedSlugs.has(slug)) {
          let i = 2;
          while (usedSlugs.has(`${slug}-${i}`)) i++;
          slug = `${slug}-${i}`;
        }
        usedSlugs.add(slug);
        el.setAttribute('id', slug);
        items.push({ id: slug, text, level: parseInt(el.tagName[1]) });
      });
      setTocItems(items);
    }, 0);
    return () => clearTimeout(timer);
  }, [article?.content]);

  useEffect(() => {
    if (tocItems.length < 2 || !contentRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length > 0) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-10% 0% -60% 0%', threshold: 0 }
    );
    const headings = contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tocItems]);

  const handleDelete = async () => {
    if (!id) return;
    setIsDeleting(true);
    try {
      await api.deleteKbArticle(id);
      toast.success('Artikel raderad');
      navigate('/kb');
    } catch {
      toast.error('Kunde inte radera artikel');
      setIsDeleting(false);
    }
  };

  const getPublicUrl = (token: string) =>
    `${window.location.origin}/kb/shared/${token}`;

  const handleToggleShare = async () => {
    if (!id) return;
    setIsTogglingShare(true);
    try {
      if (shareToken) {
        await api.revokeKbArticleShare(id);
        setShareToken(null);
        setShowShare(false);
        toast.success('Delningslänk borttagen');
      } else {
        const data = await api.createKbArticleShare(id);
        setShareToken(data.share_token);
        setShowShare(true);
        toast.success('Delningslänk skapad');
      }
    } catch {
      toast.error('Något gick fel');
    } finally {
      setIsTogglingShare(false);
    }
  };

  const handleCopyLink = () => {
    if (!shareToken) return;
    navigator.clipboard.writeText(getPublicUrl(shareToken));
    toast.success('Länk kopierad!');
  };

  const handleMarkReviewed = async () => {
    if (!id) return;
    setIsReviewing(true);
    try {
      const result = await api.reviewKbArticle(id);
      setArticle(prev => prev ? { ...prev, last_reviewed_at: result.last_reviewed_at } : prev);
      toast.success('Artikel markerad som granskad');
    } catch {
      toast.error('Kunde inte markera som granskad');
    } finally {
      setIsReviewing(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-5 w-48" />
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </Layout>
    );
  }

  if (!article) return null;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
        {/* Back + actions */}
        <div className="max-w-3xl">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/kb">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Kunskapsbas
              </Link>
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-2 print:hidden" data-print-hide>
                <Printer className="w-4 h-4" />
                <span>Skriv ut</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => shareToken ? setShowShare((v) => !v) : handleToggleShare()}
                disabled={isTogglingShare}
                className={shareToken ? 'text-primary border-primary/40' : ''}
              >
                <Share2 className="w-4 h-4 mr-2" />
                {shareToken ? 'Delad' : 'Dela'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/kb/${id}/edit`)}>
                <Edit className="w-4 h-4 mr-2" />
                Redigera
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={isDeleting}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Radera
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Radera artikel?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Detta går inte att ångra. Artikeln tas bort från alla länkade ärenden.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Avbryt</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                      Radera
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>

        {/* Share panel */}
        {showShare && shareToken && (
          <div className="max-w-3xl">
            <div className="border border-primary/30 rounded-lg p-4 bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-primary" />
                  Publik delningslänk
                </p>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setShowShare(false)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={getPublicUrl(shareToken)}
                  className="text-xs font-mono bg-background"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button size="sm" variant="outline" onClick={handleCopyLink}>
                  <LinkIcon className="w-3.5 h-3.5 mr-1.5" />
                  Kopiera
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Vem som helst med länken kan läsa artikeln utan att logga in.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive text-xs px-0"
                onClick={handleToggleShare}
                disabled={isTogglingShare}
              >
                Ta bort delningslänk
              </Button>
            </div>
          </div>
        )}

        {/* Article header */}
        <div className="max-w-3xl space-y-3">
          <h1 className="text-2xl font-bold text-foreground">{article.title}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            {article.status === 'draft' && (
              <Badge variant="outline" className="border-[hsl(var(--warning))] text-[hsl(var(--warning))]">Utkast</Badge>
            )}
            {article.category_name && (
              <Badge
                variant="secondary"
                style={article.category_color ? { backgroundColor: article.category_color + '22', color: article.category_color } : undefined}
              >
                <Folder className="w-3 h-3 mr-1.5" />
                {article.category_name}
              </Badge>
            )}
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Uppdaterad {formatDate(article.updated_at)}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Skapad {formatDate(article.created_at)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0.5 px-2 text-sm text-muted-foreground hover:text-[hsl(var(--success))] gap-1.5"
              onClick={handleMarkReviewed}
              disabled={isReviewing}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              {article.last_reviewed_at
                ? `Granskad ${formatDate(article.last_reviewed_at)}`
                : 'Markera som granskad'}
            </Button>
          </div>
          {article.tags && article.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {article.tags.map(tag => (
                <Badge key={tag.id} variant="secondary" className="gap-1" style={{ backgroundColor: tag.color + '22', color: tag.color, borderColor: tag.color + '44' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Content + ToC side-by-side */}
        <div className="flex gap-8 items-start">
          {/* Main content column */}
          <div className="flex-1 min-w-0">
            {/* Mobile ToC — collapsible */}
            {tocItems.length >= 2 && (
              <details className="lg:hidden mb-4 border rounded-lg p-3 bg-card print:hidden">
                <summary className="text-sm font-medium cursor-pointer select-none">
                  Innehåll
                </summary>
                <nav className="mt-2 space-y-1">
                  {tocItems.map((item) => (
                    <a
                      key={item.id}
                      href={`#${item.id}`}
                      className={cn(
                        'block text-sm py-0.5 transition-colors',
                        item.level >= 3 ? 'pl-4' : item.level === 2 ? 'pl-2' : '',
                        'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {item.text}
                    </a>
                  ))}
                </nav>
              </details>
            )}

            {/* Article content */}
            <div ref={contentRef} className="prose-wrapper border border-border rounded-lg p-5 bg-card min-h-[200px]">
              {article.content ? (
                <>
                  <HtmlRenderer content={article.content} />
                  <KBImageLightbox containerRef={contentRef} contentKey={article.id} />
                </>
              ) : (
                <p className="text-muted-foreground text-sm italic">Inget innehåll ännu.</p>
              )}
            </div>
          </div>

          {/* Desktop ToC sidebar — sticky right side */}
          {tocItems.length >= 2 && (
            <aside className="hidden lg:block w-52 shrink-0 print:hidden">
              <div className="sticky top-24 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                  Innehåll
                </p>
                {tocItems.map((item) => (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className={cn(
                      'block text-sm py-0.5 transition-colors',
                      item.level >= 3 ? 'pl-4' : item.level === 2 ? 'pl-2' : '',
                      activeId === item.id
                        ? 'text-primary font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {item.text}
                  </a>
                ))}
              </div>
            </aside>
          )}
        </div>

        {/* Se aven cross-reference panel */}
        {crossRefs.length > 0 && (
          <div className="max-w-3xl pt-2 border-t">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Link2 className="w-4 h-4 text-muted-foreground" />
              Se även
            </h3>
            <div className="space-y-2">
              {crossRefs.map((ref) => (
                <Link
                  key={ref.id}
                  to={`/kb/${ref.id}`}
                  className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <span className="text-sm font-medium truncate">{ref.title}</span>
                  {ref.article_type && (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {ref.article_type === 'how-to' ? 'Instruktion' : ref.article_type === 'solution' ? 'Lösning' : 'Felsökning'}
                    </Badge>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Linked Tickets panel */}
        <div className="max-w-3xl pt-2 border-t">
          <h3 className="text-sm font-semibold mb-3">Länkade biljetter</h3>
          {linkedTickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen biljett är länkad till den här artikeln
            </p>
          ) : (
            <div className="space-y-2">
              {linkedTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  to={`/tickets/${ticket.id}`}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <span className="text-sm font-medium truncate mr-2">{ticket.title}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="text-xs">{ticket.status}</Badge>
                    <Badge variant="secondary" className="text-xs">{ticket.priority}</Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default KBArticleDetail;
