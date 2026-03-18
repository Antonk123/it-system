import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Folder, Calendar } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { api, KbArticleRow } from '@/lib/api';
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

const KBArticleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<KbArticleRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      try {
        const data = await api.getKbArticle(id);
        setArticle(data);
      } catch {
        toast.error('Artikeln hittades inte');
        navigate('/kb');
      } finally {
        setIsLoading(false);
      }
    };
    fetch();
  }, [id, navigate]);

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

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  if (isLoading) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
          <div className="h-64 bg-muted animate-pulse rounded-lg" />
        </div>
      </Layout>
    );
  }

  if (!article) return null;

  return (
    <Layout>
      <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
        {/* Back + actions */}
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/kb">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Knowledge Base
            </Link>
          </Button>
          <div className="flex gap-2">
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

        {/* Article header */}
        <div className="space-y-3">
          <h1 className="text-2xl font-bold text-foreground">{article.title}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
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
          </div>
        </div>

        {/* Content */}
        <div className="prose-wrapper border border-border rounded-lg p-5 bg-card min-h-[200px]">
          {article.content ? (
            <HtmlRenderer content={article.content} />
          ) : (
            <p className="text-muted-foreground text-sm italic">Inget innehåll ännu.</p>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default KBArticleDetail;
