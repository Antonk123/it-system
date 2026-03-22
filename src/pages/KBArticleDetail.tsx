import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Folder, Calendar, Share2, Link as LinkIcon, X } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { api, KbArticleRow, LinkedTicketRow } from '@/lib/api';
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
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [showShare, setShowShare] = useState(false);
  const [isTogglingShare, setIsTogglingShare] = useState(false);
  const [linkedTickets, setLinkedTickets] = useState<LinkedTicketRow[]>([]);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      try {
        const [data, shareData, ticketsData] = await Promise.all([
          api.getKbArticle(id),
          api.getKbArticleShare(id),
          api.getArticleLinkedTickets(id),
        ]);
        setArticle(data);
        setShareToken(shareData.share_token);
        setLinkedTickets(ticketsData);
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

        {/* Share panel */}
        {showShare && shareToken && (
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
        )}

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

        {/* Linked Tickets panel */}
        <div className="pt-2 border-t">
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
