import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { ArrowLeft, Pencil, Trash2, Clock, User as UserIcon, Calendar, FileText, Lightbulb, Paperclip, Download, Share2, Copy, Link as LinkIcon, Loader2 } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useTicketAttachments } from '@/hooks/useTicketAttachments';
import { useTicketChecklists } from '@/hooks/useTicketChecklists';
import { useTicketSharing } from '@/hooks/useTicketSharing';
import { useTicketComments } from '@/hooks/useTicketComments';
import { useTicketLinks } from '@/hooks/useTicketLinks';
import { useTicketHistory } from '@/hooks/useTicketHistory';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { TicketChecklist } from '@/components/TicketChecklist';
import { TicketComments } from '@/components/TicketComments';
import { TicketLinks } from '@/components/TicketLinks';
import { TicketActivity } from '@/components/TicketActivity';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { CategoryBadge } from '@/components/CategoryBadge';
import { TagBadges } from '@/components/TagBadges';
import { TagSelector } from '@/components/TagSelector';
import { SecureImage, SecureDownloadLink } from '@/components/SecureAttachment';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { TicketStatus } from '@/types/ticket';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const formatFileSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const statusLabels: Record<TicketStatus, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

const TicketDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getTicketById, updateTicket, deleteTicket } = useTickets();
  const { getUserById } = useUsers();
  const { attachments, fetchAttachments } = useTicketAttachments();
  const { items: checklistItems, fetchChecklists, updateChecklistItem } = useTicketChecklists();
  const { comments, isLoading: commentsLoading, addComment, updateComment, deleteComment } = useTicketComments(id || '');
  const { links, isLoading: linksLoading, addLink, deleteLink } = useTicketLinks(id || '');
  const { history, isLoading: historyLoading } = useTicketHistory(id || '');
  const {
    isLoading: isShareLoading,
    shareUrl,
    createShareLink,
    copyToClipboard,
    getExistingShare,
    setShareUrl
  } = useTicketSharing();
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [ticketFieldValues, setTicketFieldValues] = useState<
    { field_name: string; field_label: string; field_value: string }[]
  >([]);
  const [tagsFromAPI, setTagsFromAPI] = useState<{ id: string; name: string; color: string }[]>([]);

  const ticket = id ? getTicketById(id) : null;
  const user = ticket ? getUserById(ticket.requesterId) : null;

  // Tags to display — prefer fresh data from single-ticket API call
  const effectiveTags = tagsFromAPI.length > 0 ? tagsFromAPI : (ticket?.tags || []);

  const refreshTagsFromAPI = (ticketId: string) => {
    api.getTicket(ticketId).then((detail) => {
      if (detail.tags) setTagsFromAPI(detail.tags);
    }).catch(() => {});
  };

  useEffect(() => {
    if (id) {
      fetchAttachments(id);
      fetchChecklists(id);
    }
  }, [id, fetchAttachments, fetchChecklists]);

  useEffect(() => {
    if (!id) return;
    api.getTicket(id).then((detail) => {
      if (detail.field_values && detail.field_values.length > 0) {
        setTicketFieldValues(detail.field_values);
      }
      // Always load fresh tags from single-ticket endpoint (list endpoint may miss them)
      if (detail.tags) setTagsFromAPI(detail.tags);
    }).catch(() => {});
  }, [id]);

  // Track recently viewed tickets in localStorage
  useEffect(() => {
    if (!id) return;
    try {
      const stored = localStorage.getItem('recently_viewed_tickets') || '[]';
      const recentIds: string[] = JSON.parse(stored);

      // Add current ID to front, remove duplicates, limit to 10
      const updated = [id, ...recentIds.filter(rid => rid !== id)].slice(0, 10);

      // Save back to localStorage
      localStorage.setItem('recently_viewed_tickets', JSON.stringify(updated));
    } catch {
      // Silently fail if localStorage is unavailable
    }
  }, [id]);

  if (!ticket) {
    return (
      <Layout>
        <div className="text-center py-16">
          <p className="text-muted-foreground">Ärendet hittades inte</p>
          <Link to="/tickets">
            <Button className="mt-4">Tillbaka till ärenden</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  const handleStatusChange = (status: TicketStatus) => {
    updateTicket(ticket.id, { status });
    toast.success(`Status uppdaterad till ${statusLabels[status]}`);
  };

  const handleTagsChange = (tagIds: string[]) => {
    updateTicket(ticket.id, { tag_ids: tagIds }).then(() => {
      refreshTagsFromAPI(ticket.id);
    });
    toast.success('Taggar uppdaterade');
  };

  const handleDelete = () => {
    deleteTicket(ticket.id);
    toast.success('Ärendet borttaget');
    navigate('/tickets');
  };

  const handleShare = async () => {
    if (!ticket) return;
    
    // Check if share already exists
    const existingToken = await getExistingShare(ticket.id);
    if (existingToken) {
      const url = `${window.location.origin}/shared/${existingToken}`;
      setShareUrl(url);
    } else {
      await createShareLink(ticket.id);
    }
    setSharePopoverOpen(true);
  };

  const handleCopyLink = () => {
    if (shareUrl) {
      copyToClipboard(shareUrl);
    }
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            className="gap-2"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Tillbaka</span>
          </Button>
          <div className="flex gap-2">
            <Popover open={sharePopoverOpen} onOpenChange={setSharePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={handleShare}
                  disabled={isShareLoading}
                >
                  {isShareLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Share2 className="w-4 h-4" />
                  )}
                  <span className="hidden sm:inline">Dela</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h4 className="font-medium text-sm">Dela ärende</h4>
                    <p className="text-xs text-muted-foreground">
                      Vem som helst med länken kan se ärendet.
                    </p>
                  </div>
                  {shareUrl && (
                    <div className="flex gap-2">
                      <Input 
                        value={shareUrl} 
                        readOnly 
                        className="text-xs"
                      />
                      <Button 
                        size="icon" 
                        variant="outline"
                        onClick={handleCopyLink}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Link to={`/tickets/${ticket.id}/edit`}>
              <Button variant="outline" className="gap-2">
                <Pencil className="w-4 h-4" />
                <span className="hidden sm:inline">Redigera</span>
              </Button>
            </Link>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="gap-2 text-destructive">
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">Ta bort</span>
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ta bort ärende</AlertDialogTitle>
                  <AlertDialogDescription>
                    Är du säker på att du vill ta bort detta ärende? Denna åtgärd kan inte ångras.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Ta bort</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="text-xl mb-2">{ticket.title}</CardTitle>
                <div className="flex items-center gap-3 flex-wrap">
                  <StatusBadge status={ticket.status} />
                  <PriorityBadge priority={ticket.priority} />
                  <CategoryBadge category={ticket.category} />
                  {effectiveTags.length > 0 && (
                    <TagBadges tags={effectiveTags as any} maxDisplay={5} />
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Quick Status Change */}
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">Status:</span>
                <Select value={ticket.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Öppen</SelectItem>
                    <SelectItem value="in-progress">Pågående</SelectItem>
                    <SelectItem value="waiting">Väntar</SelectItem>
                    <SelectItem value="resolved">Löst</SelectItem>
                    <SelectItem value="closed">Stäng ärende</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <TagSelector
                selectedTagIds={effectiveTags.map(t => t.id)}
                preloadedTags={effectiveTags as any}
                onTagsChange={handleTagsChange}
                label="Taggar"
              />
            </div>

            {/* Description / Dynamic fields */}
            <div>
              <h3 className="font-medium text-foreground mb-2">Beskrivning</h3>
              {ticketFieldValues.length > 0 ? (
                <div className="bg-muted/30 p-4 rounded-lg space-y-4">
                  {ticketFieldValues.map((fv) => (
                    <div key={fv.field_name}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                        {fv.field_label}
                      </p>
                      <MarkdownRenderer content={fv.field_value || '(ej angivet)'} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-muted/30 p-4 rounded-lg">
                  <MarkdownRenderer content={ticket.description} />
                </div>
              )}
            </div>

            {/* Checklist */}
            {checklistItems.length > 0 && (
              <div className="pt-4 border-t">
                <div className="border rounded-lg p-4">
                  <TicketChecklist
                    items={checklistItems}
                    onToggle={(id, completed) => updateChecklistItem(id, { completed })}
                    readOnly={false}
                  />
                </div>
              </div>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="pt-4 border-t">
                <div className="flex items-center gap-2 mb-3">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  <h3 className="font-medium text-foreground">
                    Bilagor ({attachments.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {attachments.map((attachment) => {
                    const isImage = attachment.fileType?.startsWith('image/');
                    return (
                      <SecureDownloadLink
                        key={attachment.id}
                        fileId={attachment.id}
                        filename={attachment.fileName}
                        className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg hover:bg-muted transition-colors group"
                      >
                        {isImage ? (
                          <SecureImage
                            fileId={attachment.id}
                            alt={attachment.fileName}
                            className="w-12 h-12 object-cover rounded"
                          />
                        ) : (
                          <div className="w-12 h-12 flex items-center justify-center bg-muted rounded">
                            <FileText className="w-6 h-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate group-hover:underline">
                            {attachment.fileName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(attachment.fileSize)}
                          </p>
                        </div>
                        <Download className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </SecureDownloadLink>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Meta Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
              <div className="flex items-center gap-3">
                <UserIcon className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Beställare</p>
                  <p className="font-medium">{user?.name || 'Okänd'}</p>
                  {user?.email && (
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Skapad</p>
                  <p className="font-medium">{format(ticket.createdAt, 'PPP', { locale: sv })}</p>
                  <p className="text-sm text-muted-foreground">{format(ticket.createdAt, 'p', { locale: sv })}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Senast uppdaterad</p>
                  <p className="font-medium">{format(ticket.updatedAt, 'PPP', { locale: sv })}</p>
                </div>
              </div>
              {ticket.resolvedAt && (
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Löst</p>
                    <p className="font-medium">{format(ticket.resolvedAt, 'PPP', { locale: sv })}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Solution */}
            {ticket.solution && (
              <div className="pt-4 border-t">
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="w-4 h-4 text-primary" />
                  <h3 className="font-medium text-foreground">Lösning</h3>
                </div>
                <div className="bg-primary/5 border border-primary/20 p-4 rounded-lg">
                  <MarkdownRenderer content={ticket.solution} />
                </div>
              </div>
            )}

            {/* Notes */}
            {ticket.notes && (
              <div className="pt-4 border-t">
                <h3 className="font-medium text-foreground mb-2">Interna anteckningar</h3>
                <div className="bg-muted/50 p-4 rounded-lg">
                  <MarkdownRenderer content={ticket.notes} />
                </div>
              </div>
            )}

            {/* Internal Comments */}
            <div className="pt-4 border-t">
              <TicketComments
                comments={comments}
                isLoading={commentsLoading}
                onAddComment={addComment}
                onUpdateComment={updateComment}
                onDeleteComment={deleteComment}
              />
            </div>

            {/* Activity Log */}
            <div className="pt-4 border-t">
              <TicketActivity history={history} isLoading={historyLoading} />
            </div>

            {/* Linked Tickets */}
            <div className="pt-4 border-t">
              <TicketLinks
                links={links}
                isLoading={linksLoading}
                currentTicketId={ticket.id}
                onAddLink={addLink}
                onDeleteLink={deleteLink}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default TicketDetail;
