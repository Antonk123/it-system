import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, Folder, Loader2, AlertCircle } from 'lucide-react';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { Badge } from '@/components/ui/badge';
import { api, KbArticleRow } from '@/lib/api';

const SharedKBArticle = () => {
  const { token } = useParams<{ token: string }>();
  const [article, setArticle] = useState<KbArticleRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError('Ingen länk angiven'); setIsLoading(false); return; }
    api.getPublicKbArticle(token)
      .then(setArticle)
      .catch(() => setError('Länken är ogiltig eller har tagits bort.'))
      .finally(() => setIsLoading(false));
  }, [token]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Laddar artikel...</p>
        </div>
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center space-y-4">
          <AlertCircle className="w-12 h-12 mx-auto text-destructive" />
          <h2 className="text-lg font-semibold">Kunde inte visa artikel</h2>
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-6">
        {/* Branding */}
        <div className="flex items-center gap-2 text-muted-foreground">
          <BookOpen className="w-4 h-4" />
          <span className="text-sm">Knowledge Base</span>
        </div>

        {/* Article header */}
        <div className="space-y-3 pb-6 border-b">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">
            {article.title}
          </h1>
          <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
            {article.category_name && (
              <Badge
                variant="secondary"
                style={article.category_color ? { backgroundColor: article.category_color + '22', color: article.category_color } : undefined}
              >
                <Folder className="w-3 h-3 mr-1.5" />
                {article.category_name}
              </Badge>
            )}
            <span>Uppdaterad {formatDate(article.updated_at)}</span>
          </div>
        </div>

        {/* Content */}
        <div className="prose-wrapper">
          {article.content ? (
            <HtmlRenderer content={article.content} />
          ) : (
            <p className="text-muted-foreground italic text-sm">Inget innehåll.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SharedKBArticle;
