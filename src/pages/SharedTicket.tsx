import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Clock, User as UserIcon, Calendar, FileText, Lightbulb, Paperclip, Download, CheckCircle2, Circle, Loader2, AlertCircle, Tag } from 'lucide-react';
import { api, SharedTicketData } from '@/lib/api';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TicketStatus, TicketPriority } from '@/types/ticket';

const formatFileSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const SharedTicket = () => {
  const { token } = useParams();
  const [data, setData] = useState<SharedTicketData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSharedTicket = async () => {
      if (!token) { setError('Ingen delningslänk angiven'); setIsLoading(false); return; }
      try {
        const result = await api.getSharedTicket(token);
        setData(result);
      } catch (err) { setError('Kunde inte hämta ärendet'); }
      finally { setIsLoading(false); }
    };
    fetchSharedTicket();
  }, [token]);

  if (isLoading) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="text-center space-y-4"><Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" /><p className="text-muted-foreground">Laddar ärende...</p></div></div>;
  if (error || !data) return <div className="min-h-screen bg-background flex items-center justify-center"><Card className="max-w-md w-full mx-4"><CardContent className="pt-6 text-center space-y-4"><AlertCircle className="w-12 h-12 mx-auto text-destructive" /><h2 className="text-lg font-semibold">Kunde inte visa ärende</h2><p className="text-muted-foreground">{error || 'Delningslänken är ogiltig.'}</p></CardContent></Card></div>;

  const { ticket, requester, attachments, checklistItems } = data;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="text-center pb-4 border-b"><p className="text-sm text-muted-foreground mb-2">Delat ärende</p><h1 className="text-2xl font-bold text-foreground">{ticket.title}</h1></div>
        <Card>
          <CardHeader className="pb-4"><div className="flex items-center gap-3 flex-wrap"><StatusBadge status={ticket.status as TicketStatus} /><PriorityBadge priority={ticket.priority as TicketPriority} />{ticket.category && <Badge variant="outline" className="gap-1 font-normal"><Tag className="w-3 h-3" />{ticket.category.label}</Badge>}</div></CardHeader>
          <CardContent className="space-y-6">
            <div><h3 className="font-medium text-foreground mb-2">Beskrivning</h3><div className="bg-muted/30 p-4 rounded-lg"><MarkdownRenderer content={ticket.description} /></div></div>
            {checklistItems.length > 0 && <div className="pt-4 border-t"><h3 className="font-medium text-foreground mb-3">Checklista</h3><div className="border rounded-lg p-4 space-y-2">{checklistItems.map((item) => <div key={item.id} className="flex items-center gap-3">{item.completed ? <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0" /> : <Circle className="w-5 h-5 text-muted-foreground flex-shrink-0" />}<span className={item.completed ? 'line-through text-muted-foreground' : ''}>{item.label}</span></div>)}</div></div>}
            {attachments.length > 0 && <div className="pt-4 border-t"><div className="flex items-center gap-2 mb-3"><Paperclip className="w-4 h-4 text-muted-foreground" /><h3 className="font-medium text-foreground">Bilagor ({attachments.length})</h3></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{attachments.map((attachment) => { const isImage = attachment.file_type?.startsWith('image/'); if (!attachment.url) return null; return <a key={attachment.id} href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors group">{isImage ? <img src={attachment.url} alt={attachment.file_name} className="w-12 h-12 object-cover rounded" /> : <div className="w-12 h-12 flex items-center justify-center bg-muted rounded"><FileText className="w-6 h-6 text-muted-foreground" /></div>}<div className="flex-1 min-w-0"><p className="text-sm font-medium truncate group-hover:underline">{attachment.file_name}</p><p className="text-xs text-muted-foreground">{formatFileSize(attachment.file_size)}</p></div><Download className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" /></a>; })}</div></div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">{requester && <div className="flex items-center gap-3"><UserIcon className="w-5 h-5 text-muted-foreground" /><div><p className="text-sm text-muted-foreground">Beställare</p><p className="font-medium">{requester.name}</p>{requester.company && <p className="text-sm text-muted-foreground">{requester.company}</p>}</div></div>}<div className="flex items-center gap-3"><Calendar className="w-5 h-5 text-muted-foreground" /><div><p className="text-sm text-muted-foreground">Skapad</p><p className="font-medium">{format(new Date(ticket.created_at), 'PPP', { locale: sv })}</p></div></div><div className="flex items-center gap-3"><Clock className="w-5 h-5 text-muted-foreground" /><div><p className="text-sm text-muted-foreground">Senast uppdaterad</p><p className="font-medium">{format(new Date(ticket.updated_at), 'PPP', { locale: sv })}</p></div></div></div>
            {ticket.solution && <div className="pt-4 border-t"><div className="flex items-center gap-2 mb-2"><Lightbulb className="w-4 h-4 text-primary" /><h3 className="font-medium text-foreground">Lösning</h3></div><div className="bg-primary/5 border border-primary/20 p-4 rounded-lg"><MarkdownRenderer content={ticket.solution} /></div></div>}
            {ticket.notes && (
              <div className="pt-4 border-t">
                <h3 className="font-medium text-foreground mb-2">Anteckningar</h3>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <MarkdownRenderer content={ticket.notes} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        <div className="text-center text-sm text-muted-foreground pt-4"><p>Detta är en delad vy av ett ärende.</p></div>
      </div>
    </div>
  );
};

export default SharedTicket;
