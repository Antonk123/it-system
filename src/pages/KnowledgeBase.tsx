import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Plus, Search, Folder, Clock, Settings2, X, Check, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, KbArticleRow, KbCategoryRow } from '@/lib/api';
import { toast } from 'sonner';
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

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const listContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};
const listItem = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } },
};

const TYPE_LABELS: Record<string, string> = {
  'how-to': 'Instruktion',
  'solution': 'Lösning',
};

function highlightTerms(text: string, query: string): string {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

const KnowledgeBase = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [articles, setArticles] = useState<KbArticleRow[]>([]);
  const [categories, setCategories] = useState<KbCategoryRow[]>([]);
  const [staleFilter, setStaleFilter] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Derive state from URL params
  const selectedCategoryId = searchParams.get('category') || '';
  const typeFilter = searchParams.get('type') || 'all';
  const search = searchParams.get('search') || '';

  const isSearching = search.length > 0;

  const updateParam = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value === null || value === '' || value === 'all') {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Category management state
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');

  const isStale = (article: KbArticleRow): boolean => {
    const ref = article.last_reviewed_at || article.created_at;
    return (Date.now() - new Date(ref).getTime()) / (86400 * 1000) > 90;
  };

  const fetchCategories = useCallback(async () => {
    try {
      const data = await api.getKbCategories();
      setCategories(data);
      return data;
    } catch {
      return [];
    }
  }, []);

  const fetchArticles = useCallback(async () => {
    try {
      const params: { search?: string; category_id?: string; article_type?: string; stale?: boolean } = {};
      if (search) {
        params.search = search;
        // Global search: do NOT pass category_id
      } else if (selectedCategoryId) {
        params.category_id = selectedCategoryId;
      }
      if (typeFilter !== 'all') params.article_type = typeFilter;
      if (staleFilter) params.stale = true;
      const data = await api.getKbArticles(params);
      setArticles(data);
    } catch {
      toast.error('Kunde inte hämta artiklar');
    }
  }, [search, selectedCategoryId, typeFilter, staleFilter]);

  // Initial load: fetch categories, then set default if needed (run once on mount)
  useEffect(() => {
    fetchCategories().then((cats) => {
      if (cats.length > 0 && !searchParams.get('category') && !searchParams.get('search')) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set('category', cats[0].id);
          return next;
        }, { replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(async () => {
      await fetchArticles();
      setIsLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchArticles]);

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
    try {
      await api.createKbCategory(newCategoryName.trim());
      await fetchCategories();
      setNewCategoryName('');
      toast.success('Kategori skapad');
    } catch {
      toast.error('Kunde inte skapa kategori');
    } finally {
      setIsCreatingCategory(false);
    }
  };

  const handleUpdateCategory = async (id: string) => {
    if (!editingCategoryName.trim()) return;
    try {
      await api.updateKbCategory(id, editingCategoryName.trim());
      await fetchCategories();
      setEditingCategoryId(null);
      toast.success('Kategori uppdaterad');
    } catch {
      toast.error('Kunde inte uppdatera kategori');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await api.deleteKbCategory(id);
      await fetchCategories();
      if (selectedCategoryId === id) updateParam('category', null);
      toast.success('Kategori raderad');
    } catch {
      toast.error('Kunde inte radera kategori');
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });

  const getPreview = (html: string, maxLen = 120) => {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '\u2026' : text;
  };

  const activeCategory = categories.find((c) => c.id === selectedCategoryId);
  const headerTitle = isSearching ? 'Sökresultat' : activeCategory?.name || 'Knowledge Base';

  return (
    <Layout>
      <div className="flex h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 border-r border-border bg-card/50 flex flex-col">
          <div className="p-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kategorier</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setShowCategoryManager((v) => !v)}
            >
              <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('category', cat.id);
                    next.delete('search');
                    return next;
                  }, { replace: true });
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors',
                  'hover:bg-accent/50',
                  selectedCategoryId === cat.id && !isSearching
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground',
                  isSearching && 'opacity-50',
                )}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color || '#888' }}
                />
                <span className="flex-1 truncate text-left">{cat.name}</span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-0">
                  {cat.article_count}
                </Badge>
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
                            className="h-7 text-xs flex-1"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleUpdateCategory(cat.id);
                              if (e.key === 'Escape') setEditingCategoryId(null);
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => handleUpdateCategory(cat.id)}
                          >
                            <Check className="w-3 h-3 text-green-600" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => setEditingCategoryId(null)}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="flex-1 text-xs text-foreground truncate">{cat.name}</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => {
                              setEditingCategoryId(cat.id);
                              setEditingCategoryName(cat.name);
                            }}
                          >
                            <Pencil className="w-2.5 h-2.5" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
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

              <div className="flex gap-1.5">
                <Input
                  placeholder="Ny kategori..."
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                />
                <Button
                  size="sm"
                  className="h-7 text-xs px-2"
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
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <BookOpen className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-foreground">{headerTitle}</h1>
                  <p className="text-sm text-muted-foreground">{articles.length} artiklar</p>
                </div>
              </div>
              <Button
                onClick={() => navigate(`/kb/new${selectedCategoryId ? `?category=${selectedCategoryId}` : ''}`)}
                size="sm"
              >
                <Plus className="w-4 h-4 mr-2" />
                Ny artikel
              </Button>
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
                  className="pl-9 pr-8"
                />
                {search ? (
                  <button
                    onClick={() => updateParam('search', null)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <kbd className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded border font-mono">/</kbd>
                )}
              </div>
              <Select value={typeFilter} onValueChange={(v) => updateParam('type', v === 'all' ? null : v)}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Alla typer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Alla typer</SelectItem>
                  <SelectItem value="how-to">Instruktion</SelectItem>
                  <SelectItem value="solution">Lösning</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 shrink-0">
                <Switch id="stale-filter" checked={staleFilter} onCheckedChange={setStaleFilter} />
                <Label htmlFor="stale-filter" className="text-sm cursor-pointer whitespace-nowrap">Visa inaktuella</Label>
              </div>
            </div>

            {/* Articles list */}
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div
                  key="skeleton"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="grid grid-cols-1 gap-2"
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
              ) : articles.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="text-center py-16 text-muted-foreground"
                >
                  <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">
                    {isSearching || typeFilter !== 'all'
                      ? 'Inga artiklar matchar sökningen'
                      : 'Inga artiklar ännu — skapa din första!'}
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="content"
                  initial={prefersReducedMotion ? false : 'hidden'}
                  animate={prefersReducedMotion ? false : 'visible'}
                  variants={listContainer}
                  className="grid grid-cols-1 gap-2"
                >
                  {articles.map((article) => (
                    <motion.div key={article.id} variants={listItem}>
                      <button
                        onClick={() => navigate(`/kb/${article.id}`)}
                        className={cn(
                          'w-full text-left p-4 rounded-lg border border-border bg-card',
                          'hover:bg-accent/50 hover:border-primary/30 transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate">{article.title}</p>
                            {article.content ? (
                              isSearching ? (
                                <p
                                  className="text-sm text-muted-foreground mt-1 line-clamp-2"
                                  // Safe: getPreview returns plain text, highlightTerms only adds <mark> with regex-escaped query
                                  dangerouslySetInnerHTML={{ __html: highlightTerms(getPreview(article.content), search) }}
                                />
                              ) : (
                                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                  {getPreview(article.content)}
                                </p>
                              )
                            ) : null}
                          </div>
                          <div className="flex flex-col items-end gap-1.5 shrink-0">
                            {isSearching && article.category_name && (
                              <Badge
                                variant="secondary"
                                className="text-xs"
                                style={article.category_color ? { backgroundColor: article.category_color + '22', color: article.category_color } : undefined}
                              >
                                <Folder className="w-2.5 h-2.5 mr-1" />
                                {article.category_name}
                              </Badge>
                            )}
                            {article.article_type && (
                              <Badge variant="outline" className="text-xs">
                                {TYPE_LABELS[article.article_type]}
                              </Badge>
                            )}
                            {isStale(article) && (
                              <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600 gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Inaktuell
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDate(article.updated_at)}
                            </span>
                          </div>
                        </div>
                      </button>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>
    </Layout>
  );
};

export default KnowledgeBase;
