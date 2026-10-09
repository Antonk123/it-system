import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router';
import { BookOpen, Plus, Search, Folder, Clock, X, Check, Pencil, Trash2, AlertTriangle, Upload, Link2, ArrowUpRight, Ellipsis } from 'lucide-react';
import { KBTagSettings } from '@/components/KBTagSettings';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { KBImportDialog } from '@/components/KBImportDialog';
import { KBPortalShareDialog } from '@/components/KBPortalShareDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { KbArticleSummary } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useKbCategories, invalidateKbCaches } from '@/hooks/useKbCategories';
import { useKbArticles, type KbArticlesParams } from '@/hooks/useKbArticles';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate } from '@/lib/date';
import { escapeHtml } from '@/lib/html';
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
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/contexts/AuthContext';

const listContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const listItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};
// Bara de första korten får stagger-animation; resten visas direkt.
const STAGGERED_ITEMS = 10;

const STATUS_FILTERS = ['published', 'draft', 'all'] as const;

const TYPE_LABELS: Record<string, string> = {
  'how-to': 'Instruktion',
  'solution': 'Lösning',
};

function highlightTerms(text: string, query: string): string {
  // Escapa ALLTID texten innan vi injicerar via dangerouslySetInnerHTML —
  // serverns preview strippar taggar men escapar inte entiteter, så rå <, > eller &
  // i artikelinnehållet skulle annars tolkas som markup (DOM-XSS).
  const safe = escapeHtml(text);
  if (!query.trim()) return safe;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

const KnowledgeBase = () => {
  // Beräknas inuti komponenten — inte på modulnivå — för att undvika SSR/test-krasch
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const { categories, createCategory, updateCategory, deleteCategory } = useKbCategories();
  const [staleFilter, setStaleFilter] = useState(false);

  // Derive state from URL params
  const selectedCategoryId = searchParams.get('category') || '';
  const typeFilter = searchParams.get('type') || 'all';
  const search = searchParams.get('search') || '';
  const statusParam = searchParams.get('status');
  const statusFilter: NonNullable<KbArticlesParams['status']> =
    isAdmin && STATUS_FILTERS.some(value => value === statusParam) ? (statusParam as NonNullable<KbArticlesParams['status']>) : 'published';

  const isSearching = search.length > 0;
  // Debounce the query input so typing doesn't fire one fetch per keystroke
  // (the URL/input value updates immediately; only the fetch is delayed).
  const debouncedSearch = useDebounce(search, 200);

  const { articles, total, isLoading, isError, refetch: refetchArticles, hasNextPage, fetchNextPage, isFetchingNextPage } = useKbArticles({
    search: debouncedSearch || undefined,
    category_id: !debouncedSearch && selectedCategoryId ? selectedCategoryId : undefined,
    article_type: typeFilter !== 'all' ? typeFilter : undefined,
    stale: staleFilter || undefined,
    status: statusFilter !== 'published' ? statusFilter : undefined,
  });

  const updateParam = (key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === '' || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    }, { replace: true });
  };

  // Import dialog state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showPortalShareDialog, setShowPortalShareDialog] = useState(false);

  // Category management state
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [isSavingCategoryId, setIsSavingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  const isStale = (article: KbArticleSummary): boolean => {
    const ref = article.last_reviewed_at || article.created_at;
    return (Date.now() - new Date(ref).getTime()) / (86400 * 1000) > 90;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return;
    setIsCreatingCategory(true);
    if (await createCategory(newCategoryName.trim())) setNewCategoryName('');
    setIsCreatingCategory(false);
  };

  const handleUpdateCategory = async (id: string) => {
    if (!editingCategoryName.trim()) return;
    if (isSavingCategoryId) return;
    setIsSavingCategoryId(id);
    if (await updateCategory(id, editingCategoryName.trim())) setEditingCategoryId(null);
    setIsSavingCategoryId(null);
  };

  const handleDeleteCategory = async (id: string) => {
    if (await deleteCategory(id) && selectedCategoryId === id) updateParam('category', null);
  };

  const selectCategory = (categoryId: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (categoryId) next.set('category', categoryId);
      else next.delete('category');
      next.delete('search');
      return next;
    }, { replace: true });
  };
  const clearFilters = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('type');
      next.delete('status');
      return next;
    }, { replace: true });
    setStaleFilter(false);
  };

  const activeCategory = categories.find((c) => c.id === selectedCategoryId);
  const headerTitle = isSearching ? 'Sökresultat' : activeCategory?.name || 'Alla artiklar';

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-6">
        <section aria-label="Sök i kunskapsbasen" className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 md:p-8 space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex p-3 rounded-2xl bg-primary/10 border border-primary/15">
                  <BookOpen className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">Kunskapsbas</h1>
                  <p className="mt-2 text-sm md:text-base text-muted-foreground">Instruktioner och lösningar för arbetsdagen.</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <details className="relative">
                  <Button asChild variant="outline" className="min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <summary><Ellipsis aria-hidden="true" />Hantera</summary>
                  </Button>
                  <div className="absolute right-0 z-20 mt-2 w-64 rounded-md border bg-popover p-3 shadow-md flex flex-col gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowImportDialog(true)}
                  size="sm"
                  className="min-h-11"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Importera
                </Button>
                {user?.role === 'admin' && (
                  <Button
                    variant="outline"
                    onClick={() => setShowPortalShareDialog(true)}
                    size="sm"
                  className="min-h-11"
                  >
                    <Link2 className="w-4 h-4 mr-2" />
                    Publik länk
                  </Button>
                )}
          {user?.role === 'admin' && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" className="mx-2 mb-2 justify-start min-h-11">Hantera KB-taggar</Button>
              </DialogTrigger>
              <DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Hantera kunskapsbasens taggar</DialogTitle>
                  <DialogDescription>Skapa och redigera taggar för artiklar.</DialogDescription>
                </DialogHeader>
                <KBTagSettings />
              </DialogContent>
            </Dialog>
          )}
                <Button variant="outline" onClick={() => setShowCategoryManager(v => !v)}>Kategorier</Button>
                </div></details>
                <Button
                  onClick={() => navigate(`/kb/new${selectedCategoryId ? `?category=${selectedCategoryId}` : ''}`)}
                  size="sm"
                  className="min-h-11"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Ny artikel
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex gap-3 flex-col sm:flex-row flex-wrap">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  placeholder="Sök i alla artiklar..."
                  value={search}
                  onChange={(e) => updateParam('search', e.target.value || null)}
                  aria-label="Sök i kunskapsbasen"
                  className="min-h-12 pl-10 pr-12 bg-background text-base"
                />
                {search ? (
                  <button
                    onClick={() => updateParam('search', null)}
                    aria-label="Rensa sökning"
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <kbd className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border font-mono">/</kbd>
                )}
              </div>
              <Select value={typeFilter} onValueChange={(v) => updateParam('type', v === 'all' ? null : v)}>
                <SelectTrigger aria-label="Artikeltyp" className="min-h-12 w-full sm:w-[180px] bg-background">
                  <SelectValue placeholder="Alla typer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla typer</SelectItem>
                  <SelectItem value="how-to">Instruktion</SelectItem>
                  <SelectItem value="solution">Lösning</SelectItem>
                </SelectContent>
              </Select>
              {isAdmin && (
                <Select value={statusFilter} onValueChange={(v) => updateParam('status', v === 'published' ? null : v)}>
                  <SelectTrigger aria-label="Status" className="min-h-12 w-full sm:w-[160px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="published">Publicerade</SelectItem>
                    <SelectItem value="draft">Utkast</SelectItem>
                    <SelectItem value="all">Alla</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <div className="flex items-center gap-2 shrink-0">
                <Switch id="stale-filter" checked={staleFilter} onCheckedChange={setStaleFilter} />
                <Label htmlFor="stale-filter" className="text-sm cursor-pointer whitespace-nowrap">Visa inaktuella</Label>
              </div>
            </div>

        </section>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sidebar */}
        <aside className="min-w-0 self-start rounded-xl border border-border bg-card p-2 space-y-2">
          <div className="p-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kategorier</span>

          </div>



          <div className="px-1 pb-1 lg:hidden">
            <Label htmlFor="kb-category-mobile" className="sr-only">Kategori</Label>
            <Select value={isSearching ? 'all' : selectedCategoryId || 'all'} onValueChange={value => selectCategory(value === 'all' ? '' : value)}>
              <SelectTrigger id="kb-category-mobile" className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alla artiklar</SelectItem>
                {categories.map(cat => <SelectItem key={cat.id} value={cat.id}>{cat.name} ({cat.article_count})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <nav aria-label="Artikelkategorier" className="hidden lg:block space-y-1">
            <button type="button" onClick={() => selectCategory('')}
              aria-current={!selectedCategoryId && !isSearching ? 'page' : undefined}
              className={cn('w-full min-h-11 flex items-center gap-2 rounded-lg px-3 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !selectedCategoryId && !isSearching ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />Alla artiklar
            </button>
            {categories.map(cat => (
              <button key={cat.id} type="button" onClick={() => selectCategory(cat.id)}
                aria-current={selectedCategoryId === cat.id && !isSearching ? 'page' : undefined}
                className={cn('w-full min-h-11 flex items-center gap-2 rounded-lg px-3 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selectedCategoryId === cat.id && !isSearching ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: cat.color || 'currentColor' }} aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words">{cat.name}</span>
                <span className="text-xs tabular-nums rounded-md bg-muted px-1.5 py-0.5">{cat.article_count}</span>
              </button>
            ))}
          </nav>

          {/* Category manager */}
          {showCategoryManager && (
            <div className="border-t border-border p-3 space-y-3">
              <h2 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Folder className="w-3.5 h-3.5" />
                Hantera kategorier
              </h2>

              {categories.length === 0 ? (
                <p className="text-xs text-muted-foreground">Inga kategorier ännu.</p>
              ) : (
                <div className="space-y-1">
                  {categories.map((cat) => (
                    <div key={cat.id} className="flex items-center gap-1 group">
                      {editingCategoryId === cat.id ? (
                        <>
                          <Input
                            value={editingCategoryName}
                            onChange={(e) => setEditingCategoryName(e.target.value)}
                            className="h-11 text-sm flex-1"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleUpdateCategory(cat.id);
                              if (e.key === 'Escape') setEditingCategoryId(null);
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-11 w-11 p-0 shrink-0"
                            onClick={() => handleUpdateCategory(cat.id)}
                            disabled={isSavingCategoryId === cat.id}
                            aria-label="Spara kategorinamn"
                          >
                            <Check className="w-3.5 h-3.5 text-[hsl(var(--success))]" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-11 w-11 p-0 shrink-0"
                            onClick={() => setEditingCategoryId(null)}
                            aria-label="Avbryt redigering"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-xs text-foreground truncate">{cat.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-11 w-11 p-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
                            onClick={() => {
                              setEditingCategoryId(cat.id);
                              setEditingCategoryName(cat.name);
                            }}
                            aria-label={`Redigera kategorin ${cat.name}`}
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-11 w-11 p-0 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-destructive hover:text-destructive shrink-0"
                                aria-label={`Ta bort kategorin ${cat.name}`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Ta bort kategori</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Är du säker på att du vill ta bort kategorin &quot;{cat.name}&quot;? Denna åtgärd kan inte ångras.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Avbryt</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDeleteCategory(cat.id)}>Ta bort</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Input
                  placeholder="Ny kategori..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="h-11 min-w-0 text-sm"
                  aria-label="Ny kategori"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                />
                <Button
                  size="sm"
                  className="min-h-11 w-full shrink-0 whitespace-nowrap text-sm px-3"
                  onClick={handleCreateCategory}
                  disabled={isCreatingCategory || !newCategoryName.trim()}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Lägg till
                </Button>
              </div>
            </div>
          )}
        </aside>

        {/* Main content */}
        <section aria-labelledby="kb-results-heading" className="min-w-0 space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="kb-results-heading" className="text-xl font-semibold tracking-tight">{headerTitle}</h2>
            <span className="shrink-0 text-sm text-muted-foreground" aria-live="polite">{isLoading ? 'Laddar…' : `${total} ${total === 1 ? 'artikel' : 'artiklar'}`}</span>
          </div>
          <div className="space-y-4">
            {/* Articles list */}
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div
                  key="skeleton"
                  initial={prefersReducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4"
                >
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="bg-card rounded-lg border border-border p-4 space-y-2">
                      <Skeleton className="h-5 w-full" />
                      <div className="flex gap-2">
                        <Skeleton className="h-4 w-16" />
                        <Skeleton className="h-4 w-12" />
                      </div>
                    </div>
                  ))}
                </motion.div>
              ) : isError ? (
                <motion.div
                  key="error"
                  initial={prefersReducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
                  className="text-center py-12 space-y-2"
                >
                  <p className="text-destructive text-sm">Kunde inte hämta artiklar</p>
                  <Button variant="outline" size="sm" onClick={refetchArticles}>Försök igen</Button>
                </motion.div>
              ) : articles.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={prefersReducedMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
                >
                  <EmptyState
                    icon={<BookOpen />}
                    className="rounded-xl border-dashed min-h-64 justify-center"
                    title={
                      isSearching
                        ? `Inga artiklar hittades för "${search}"`
                        : typeFilter !== 'all' || staleFilter || statusFilter !== 'published'
                        ? 'Inga artiklar matchar filtret'
                        : activeCategory ? `Inga artiklar i ${activeCategory.name} ännu` : 'Samla kunskapen här'
                    }
                    description={
                      !isSearching && typeFilter === 'all' && !staleFilter && statusFilter === 'published'
                        ? 'Kom igång genom att skapa din första artikel.'
                        : undefined
                    }
                    action={isSearching ? (
                      <Button className="min-h-11" variant="outline" onClick={() => updateParam('search', null)}>Rensa sökning</Button>
                    ) : typeFilter !== 'all' || staleFilter || statusFilter !== 'published' ? (
                      <Button className="min-h-11" variant="outline" onClick={clearFilters}>Rensa filter</Button>
                    ) : (
                      <Button className="min-h-11" onClick={() => navigate(`/kb/new${selectedCategoryId ? `?category=${selectedCategoryId}` : ''}`)}>
                        <Plus className="w-4 h-4 mr-2" />Skapa artikel
                      </Button>
                    )}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="content"
                  initial={prefersReducedMotion ? false : 'hidden'}
                  animate={prefersReducedMotion ? false : 'visible'}
                  variants={listContainer}
                  className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-4"
                >
                  {articles.map((article, index) => (
                    <motion.div key={article.id} variants={index < STAGGERED_ITEMS ? listItem : undefined}>
                      <button
                        onClick={() => navigate(`/kb/${article.id}`)}
                        className={cn(
                          'group h-full w-full text-left p-5 md:p-6 rounded-xl border border-border bg-card shadow-sm',
                          'hover:bg-muted/30 hover:border-primary/40 transition-colors',
                          'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary'
                        )}
                      >
                        <div className="flex h-full flex-col gap-4">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Folder className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>{article.category_name || categories.find(category => category.id === article.category_id)?.name || 'Utan kategori'}</span>
                            <ArrowUpRight className="ml-auto h-4 w-4 group-hover:text-primary" aria-hidden="true" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-lg leading-snug text-foreground line-clamp-2">{article.title}</h3>
                            {article.preview ? (
                              isSearching ? (
                                <p
                                  className="text-sm leading-relaxed text-muted-foreground mt-2 line-clamp-2"
                                  // Säkert: highlightTerms HTML-escapar texten innan den lägger på <mark>,
                                  // så bara <mark>-taggarna är riktig HTML (söktermen är dessutom regex-escapad).
                                  dangerouslySetInnerHTML={{ __html: highlightTerms(article.preview, search) }}
                                />
                              ) : (
                                <p className="text-sm leading-relaxed text-muted-foreground mt-2 line-clamp-2">
                                  {article.preview}
                                </p>
                              )
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                            {article.status === 'draft' && (
                              <Badge variant="outline" className="text-xs border-[hsl(var(--warning))] text-[hsl(var(--warning))]">Utkast</Badge>
                            )}
                            {article.article_type && (
                              <Badge variant="outline" className="text-xs">
                                {TYPE_LABELS[article.article_type]}
                              </Badge>
                            )}
                            {isStale(article) && (
                              <Badge variant="outline" className="text-xs border-[hsl(var(--warning))]/50 text-[hsl(var(--warning))] gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Inaktuell
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground flex items-center gap-1 ml-auto">
                              <Clock className="w-3 h-3" />
                              {formatDate(article.updated_at, { year: 'numeric', month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                        </div>
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
            {hasNextPage && !isLoading && !isError && (
              <div className="flex justify-center">
                <Button variant="outline" className="min-h-11" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? 'Laddar…' : `Visa fler (${articles.length} av ${total})`}
                </Button>
              </div>
            )}
          </div>
        </section>
        </div>
      </div>
      <KBImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        defaultCategoryId={selectedCategoryId}
        onImported={() => invalidateKbCaches(queryClient)}
      />
      {user?.role === 'admin' && (
        <KBPortalShareDialog
          open={showPortalShareDialog}
          onOpenChange={setShowPortalShareDialog}
        />
      )}
    </>
  );
};

export default KnowledgeBase;
