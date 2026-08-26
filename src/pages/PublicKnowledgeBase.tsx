import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { AlertCircle, BookOpen, Clock, Folder, Search, Tag, X } from 'lucide-react';
import { api, type KbPortalArticleSummary, type KbPortalCategoryRow } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';
import { PublicKBChrome } from '@/components/PublicKBChrome';
import { usePublicKBPageMeta } from '@/components/publicKBPresentation';

const TYPE_LABELS: Record<string, string> = { 'how-to': 'Instruktion', solution: 'Lösning' };

function plainSnippet(value: string | null | undefined) {
  return (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function PublicKnowledgeBase() {
  const { token } = useParams<{ token: string }>();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<KbPortalCategoryRow[]>([]);
  const [articles, setArticles] = useState<KbPortalArticleSummary[]>([]);
  const [categoriesError, setCategoriesError] = useState(false);
  const [articlesError, setArticlesError] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const categoryId = searchParams.get('category') ?? '';
  const querySearch = searchParams.get('search') ?? '';
  const [searchInput, setSearchInput] = useState(querySearch);
  const debouncedSearch = useDebounce(searchInput, 250);
  const searchRef = useRef<HTMLInputElement>(null);
  const usableCategories = useMemo(() => categories.filter((category) => category.article_count > 0), [categories]);
  const allArticlesCount = useMemo(() => usableCategories.reduce((sum, category) => sum + category.article_count, 0), [usableCategories]);

  usePublicKBPageMeta('IT Kunskapsbas');

  useEffect(() => setSearchInput(querySearch), [querySearch]);

  useEffect(() => {
    if (debouncedSearch === querySearch) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (debouncedSearch.trim()) next.set('search', debouncedSearch.trim());
      else next.delete('search');
      return next;
    }, { replace: true });
  }, [debouncedSearch, querySearch, setSearchParams]);

  useEffect(() => {
    if (!token) {
      setCategoriesError(true);
      setArticlesError(true);
      setLoadingCategories(false);
      setLoadingArticles(false);
      return;
    }
    let active = true;
    setLoadingCategories(true);
    setCategoriesError(false);
    api.getKbPortalCategories(token)
      .then((result) => active && setCategories(result))
      .catch(() => active && setCategoriesError(true))
      .finally(() => active && setLoadingCategories(false));
    return () => { active = false; };
  }, [token, retryCount]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    setLoadingArticles(true);
    setArticlesError(false);
    api.getKbPortalArticles(token, {
      search: querySearch || undefined,
      category_id: categoryId || undefined,
    })
      .then((result) => active && setArticles(result))
      .catch(() => active && setArticlesError(true))
      .finally(() => active && setLoadingArticles(false));
    return () => { active = false; };
  }, [token, querySearch, categoryId, retryCount]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const chooseCategory = (nextCategoryId: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextCategoryId) next.set('category', nextCategoryId);
      else next.delete('category');
      return next;
    });
  };
  const retry = () => {
    setRetryCount((count) => count + 1);
  };

  return (
    <PublicKBChrome>
      <main id="huvudinnehall" className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
        <div className="mb-7 max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Hur kan vi hjälpa dig?</h1>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">Sök bland guider, rutiner och beprövade lösningar.</p>
        </div>

        <div className="relative mb-5 max-w-3xl">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label className="sr-only" htmlFor="portal-search">Sök i kunskapsbasen</label>
          <input
            ref={searchRef}
            id="portal-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Sök i kunskapsbasen"
            className="h-12 w-full rounded-lg border border-input bg-background pl-12 pr-12 text-base shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
          />
          {searchInput ? (
            <button type="button" onClick={() => setSearchInput('')} className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Rensa sökning">
              <X className="h-5 w-5" />
            </button>
          ) : <kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">/</kbd>}
        </div>

        <label className="mb-5 block lg:hidden">
          <span className="sr-only">Filtrera på kategori</span>
          <select value={categoryId} onChange={(event) => chooseCategory(event.target.value)} className="h-12 w-full rounded-lg border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">Alla artiklar</option>
            {usableCategories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.article_count})</option>)}
          </select>
        </label>

        <div className="grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="hidden lg:block" aria-label="Kategorier">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kategorier</p>
            <nav className="space-y-1">
              <CategoryButton active={!categoryId} label="Alla artiklar" count={allArticlesCount} onClick={() => chooseCategory('')} />
              {usableCategories.map((category) => <CategoryButton key={category.id} active={categoryId === category.id} label={category.name} count={category.article_count} color={category.color} onClick={() => chooseCategory(category.id)} />)}
            </nav>
          </aside>

          <section aria-live="polite">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{querySearch ? `Sökresultat för ”${querySearch}”` : categoryId ? usableCategories.find((category) => category.id === categoryId)?.name ?? 'Artiklar' : 'Alla artiklar'}</h2>
              {!loadingArticles && !articlesError && <span className="text-sm text-muted-foreground">{articles.length} {articles.length === 1 ? 'artikel' : 'artiklar'}</span>}
            </div>
            {categoriesError || articlesError ? <ErrorState onRetry={retry} /> : loadingCategories || loadingArticles ? <LoadingState /> : articles.length === 0 ? <EmptyState hasSearch={Boolean(querySearch)} /> : (
              <div className="grid gap-3 sm:grid-cols-2">
                {articles.map((article) => <ArticleCard key={article.id} article={article} to={{ pathname: `/kb/public/${token}/article/${article.id}`, search: location.search }} />)}
              </div>
            )}
          </section>
        </div>
      </main>
    </PublicKBChrome>
  );
}

function CategoryButton({ active, label, count, color, onClick }: { active: boolean; label: string; count: number; color?: string | null; onClick: () => void }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn('flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none', active ? 'bg-primary/10 font-medium text-primary' : 'text-foreground')}>
    {color ? <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" /> : <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />}
    <span className="min-w-0 flex-1 truncate">{label}</span><span className="text-xs tabular-nums text-muted-foreground">{count}</span>
  </button>;
}

function ArticleCard({ article, to }: { article: KbPortalArticleSummary; to: { pathname: string; search: string } }) {
  const snippet = plainSnippet(article.snippet);
  return <Link to={to} state={{ fromPortal: true }} className="group flex min-h-44 flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none">
    <div className="flex items-start gap-3"><BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><h3 className="font-semibold leading-snug group-hover:text-primary">{article.title}</h3></div>
    {snippet && <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{snippet}</p>}
    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-4 text-xs text-muted-foreground">
      {article.category_name && <span className="inline-flex items-center gap-1"><Folder className="h-3.5 w-3.5" />{article.category_name}</span>}
      {article.article_type && <span>{TYPE_LABELS[article.article_type] ?? article.article_type}</span>}
      {(article.tags ?? []).map((tag) => <span key={tag.id} className="inline-flex items-center gap-1"><Tag className="h-3.5 w-3.5" />{tag.name}</span>)}
      <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{formatDate(article.updated_at, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
    </div>
  </Link>;
}

function LoadingState() { return <div className="grid gap-3 sm:grid-cols-2" aria-label="Laddar artiklar">{Array.from({ length: 4 }, (_, index) => <div key={index} className="min-h-44 animate-pulse rounded-xl border border-border bg-card p-5 motion-reduce:animate-none"><div className="h-5 w-3/4 rounded bg-muted" /><div className="mt-4 h-4 w-full rounded bg-muted" /><div className="mt-2 h-4 w-2/3 rounded bg-muted" /></div>)}</div>; }
function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><AlertCircle className="mx-auto h-7 w-7 text-destructive" /><h3 className="mt-3 font-semibold">Kunde inte hämta kunskapsbasen</h3><p className="mt-1 text-sm text-muted-foreground">Kontrollera länken och försök igen.</p><button type="button" onClick={onRetry} className="mt-4 min-h-11 rounded-md border border-input px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Försök igen</button></div>; }
function EmptyState({ hasSearch }: { hasSearch: boolean }) { return <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center"><BookOpen className="mx-auto h-8 w-8 text-muted-foreground" /><h3 className="mt-3 font-semibold">{hasSearch ? 'Inga artiklar hittades' : 'Inga publicerade artiklar ännu'}</h3><p className="mt-1 text-sm text-muted-foreground">{hasSearch ? 'Prova med ett annat sökord eller en annan kategori.' : 'Här visas artiklar när de har publicerats.'}</p></div>; }
