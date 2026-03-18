import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Search, Folder, Clock } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, KbArticleRow, KbCategoryRow } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const KnowledgeBase = () => {
  const navigate = useNavigate();
  const [articles, setArticles] = useState<KbArticleRow[]>([]);
  const [categories, setCategories] = useState<KbCategoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);

  const fetchArticles = useCallback(async () => {
    try {
      const params: { search?: string; category_id?: string } = {};
      if (search) params.search = search;
      if (categoryFilter !== 'all') params.category_id = categoryFilter;
      const data = await api.getKbArticles(params);
      setArticles(data);
    } catch (error) {
      toast.error('Kunde inte hämta artiklar');
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const data = await api.getKbCategories();
        setCategories(data);
      } catch {
        // non-critical
      }
    };
    fetchCategories();
  }, []);

  useEffect(() => {
    setIsLoading(true);
    const timer = setTimeout(async () => {
      await fetchArticles();
      setIsLoading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchArticles]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'short', day: 'numeric' });

  // Strip HTML tags for preview text
  const getPreview = (html: string, maxLen = 120) => {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookOpen className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Knowledge Base</h1>
              <p className="text-sm text-muted-foreground">{articles.length} artiklar</p>
            </div>
          </div>
          <Button onClick={() => navigate('/kb/new')} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Ny artikel
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-col sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Sök artiklar..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Alla kategorier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alla kategorier</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Articles list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <BookOpen className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {search || categoryFilter !== 'all'
                ? 'Inga artiklar matchar sökningen'
                : 'Inga artiklar ännu — skapa din första!'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {articles.map((article) => (
              <button
                key={article.id}
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
                    {article.content && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {getPreview(article.content)}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {article.category_name && (
                      <Badge
                        variant="secondary"
                        className="text-xs"
                        style={article.category_color ? { backgroundColor: article.category_color + '22', color: article.category_color } : undefined}
                      >
                        <Folder className="w-2.5 h-2.5 mr-1" />
                        {article.category_name}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(article.updated_at)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default KnowledgeBase;
