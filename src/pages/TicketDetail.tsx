import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { ArrowLeft, Pencil, Trash2, Clock, User as UserIcon, Calendar, FileText, Lightbulb, Paperclip, Download, Share2, Copy, Link as LinkIcon, Loader2, ListChecks, Plus } from 'lucide-react';
import { useTickets } from '@/hooks/useTickets';
import { useUsers } from '@/hooks/useUsers';
import { useTicketAttachments } from '@/hooks/useTicketAttachments';
import { useTicketChecklists, ChecklistItem } from '@/hooks/useTicketChecklists';
import { useChecklistTemplates } from '@/hooks/useChecklistTemplates';
import { useTicketSharing } from '@/hooks/useTicketSharing';
import { useTicketComments } from '@/hooks/useTicketComments';
import { useTicketLinks } from '@/hooks/useTicketLinks';
import { useTicketHistory } from '@/hooks/useTicketHistory';
import { useTicketReminders } from '@/hooks/useTicketReminders';
import { addRecentlyViewedTicket } from '@/lib/recentlyViewed';
import { HtmlRenderer } from '@/components/HtmlRenderer';
import { migrateContent } from '@/lib/contentMigration';
import { TicketChecklist } from '@/components/TicketChecklist';
import { TicketComments } from '@/components/TicketComments';
import { TicketLinks } from '@/components/TicketLinks';
import { KBLinksSection } from '@/components/KBLinksSection';
import { TicketActivity } from '@/components/TicketActivity';
import { ReminderDialog } from '@/components/ReminderDialog';
import { ReminderList } from '@/components/ReminderList';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
  const location = useLocation();
  const { getTicketById, updateTicket, deleteTicket, isLoading: ticketsLoading } = useTickets();
  const { getUserById } = useUsers();
  const { attachments, fetchAttachments } = useTicketAttachments();
  const { items: checklistItems, fetchChecklists, addChecklistItem, updateChecklistItem, deleteChecklistItem, setItems: setChecklistItems } = useTicketChecklists();
  const { templates: checklistTemplates, fetchTemplates: fetchChecklistTemplates, createTemplate: createChecklistTemplate, applyTemplate: applyChecklistTemplate } = useChecklistTemplates();
  const { comments, isLoading: commentsLoading, addComment, updateComment, deleteComment } = useTicketComments(id || '');
  const { links, isLoading: linksLoading, addLink, deleteLink } = useTicketLinks(id || '');
  const { history, isLoading: historyLoading } = useTicketHistory(id || '');
  const { reminders, fetchReminders, createReminder, deleteReminder } = useTicketReminders(id || '');
  const {
    isLoading: isShareLoading,
    shareUrl,
    createShareLink,
    copyToClipboard,
    getExistingShare,
    setShareUrl
  } = useTicketSharing();
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [pendingTemplateItems, setPendingTemplateItems] = useState<ChecklistItem[]>([]);

  const hasVisibleContent = (html: string | null | undefined): boolean => {
    if (!html) return false;
    return html.replace(/<[^>]*>/g, '').trim().length > 0;
  };
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
      fetchReminders();
      fetchChecklistTemplates();
    }
  }, [id, fetchAttachments, fetchChecklists, fetchReminders, fetchChecklistTemplates]);

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

  // Track recently viewed tickets
  useEffect(() => {
    if (!ticket?.id || !ticket?.title) return;
    addRecentlyViewedTicket(ticket.id, ticket.title);
  }, [ticket?.id, ticket?.title]);

  if (ticketsLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

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
      toast.success('Taggar uppdaterade');
    }).catch(() => {
      refreshTagsFromAPI(ticket.id);
      toast.error('Kunde inte uppdatera taggar');
    });
  };

  const handleDelete = async () => {
    try {
      await deleteTicket(ticket.id);
      toast.success('Ärendet borttaget');
      navigate('/tickets');
    } catch {
      toast.error('Kunde inte ta bort ärendet');
    }
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

  const handleClone = () => {
    navigate('/tickets/new', {
      state: {
        cloneData: {
          title: ticket.title,
          description: ticket.description,
          category: ticket.category || 'none',
          priority: ticket.priority,
          templateId: ticket.templateId || null,
          customFieldValues: ticketFieldValues.length > 0
            ? ticketFieldValues.map(fv => ({
                field_name: fv.field_name,
                field_label: fv.field_label,
                field_value: fv.field_value,
              }))
            : [],
        },
      },
    });
    toast.success(`Formuläret förfyllt från ärende #${ticket.id}`);
  };

  const handleBack = () => {
    if (location.state?.from) {
      // Navigate back to source page (preserves filters/pagination)
      navigate(location.state.from);
    } else {
      // No source info - fall back to history or default
      if (window.history.length > 2) {
        navigate(-1);
      } else {
        navigate('/tickets');
      }
    }
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Button
            variant="ghost"
            className="gap-2"
            onClick={handleBack}
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
            <ReminderDialog onCreateReminder={createReminder} />
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => navigate(`/tickets/${ticket.id}/edit`, {
                state: { from: location.state?.from || location.pathname + location.search }
              })}
            >
              <Pencil className="w-4 h-4" />
              <span className="hidden sm:inline">Redigera</span>
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleClone}
            >
              <Copy className="w-4 h-4" />
              <span className="hidden sm:inline">Klona ärende</span>
            </Button>
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
            <div className="space-y-4 p-4 bg-card border border-border rounded-lg">
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
                <div className="bg-secondary/30 border border-border p-4 rounded-lg space-y-4">
                  {ticketFieldValues.map((fv) => (
                    <div key={fv.field_name}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                        {fv.field_label}
                      </p>
                      <HtmlRenderer content={migrateContent(fv.field_value || '(ej angivet)')} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-secondary/30 border border-border p-4 rounded-lg">
                  <HtmlRenderer content={migrateContent(ticket.description)} />
                </div>
              )}
            </div>

            {/* Checklist — only expand when there are items or user opens it */}
            {checklistItems.length > 0 || checklistOpen ? (
              <div className="pt-4 border-t">
                <div className="border rounded-lg p-4">
                  <TicketChecklist
                    items={checklistItems}
                    onToggle={(itemId, completed) => updateChecklistItem(itemId, { completed })}
                    onDelete={(itemId) => deleteChecklistItem(itemId)}
                    onAdd={(label, parentId) => id ? addChecklistItem(id, label, { parent_id: parentId }) : undefined}
                    onUpdate={(itemId, updates) => updateChecklistItem(itemId, updates)}
                    readOnly={false}
                    templates={checklistTemplates}
                    onApplyTemplate={async (template) => {
                      if (!id) return;
                      const newItems = await applyChecklistTemplate(template.id, id);
                      if (newItems) setChecklistItems(newItems as ChecklistItem[]);
                    }}
                    onSaveAsTemplate={async (currentItems) => {
                      setPendingTemplateItems(currentItems);
                      setTemplateName('');
                      setTemplateDialogOpen(true);
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="pt-4 border-t">
                <button
                  onClick={() => setChecklistOpen(true)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <ListChecks className="w-3.5 h-3.5" />
                  Lägg till checklista
                </button>
              </div>
            )}

            {/* Reminders */}
            {reminders.length > 0 && (
              <div className="pt-4 border-t">
                <ReminderList
                  reminders={reminders}
                  onDeleteReminder={deleteReminder}
                />
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
                  <Lightbulb className="w-4 h-4 text-success" />
                  <h3 className="font-medium text-foreground">Lösning</h3>
                </div>
                <div className="bg-success/20 border border-success/40 p-4 rounded-lg">
                  <HtmlRenderer content={migrateContent(ticket.solution)} />
                </div>
              </div>
            )}

            {/* Notes + Comments — unified internal communication section */}
            <div className="pt-4 border-t">
              {hasVisibleContent(ticket.notes) && (
                <div className="mb-4 bg-muted/40 border border-border p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Anteckning</span>
                    <button
                      onClick={() => navigate(`/tickets/${ticket.id}/edit`, {
                        state: { from: location.state?.from || location.pathname + location.search }
                      })}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Redigera
                    </button>
                  </div>
                  <HtmlRenderer content={migrateContent(ticket.notes!)} />
                </div>
              )}
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

            {/* Linked KB Articles */}
            <div className="pt-4 border-t">
              <KBLinksSection ticketId={ticket.id} ticketTitle={ticket.title} />
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
      {/* Template name dialog */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Spara som mall</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Namn på mallen..."
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && templateName.trim()) {
                const items = pendingTemplateItems
                  .filter(i => !i.parent_id)
                  .flatMap(parent => {
                    const children = pendingTemplateItems.filter(c => c.parent_id === parent.id);
                    return [
                      { label: parent.label },
                      ...children.map(c => ({ label: c.label, parent_label: parent.label })),
                    ];
                  });
                createChecklistTemplate({ name: templateName.trim(), items });
                setTemplateDialogOpen(false);
              }
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialogOpen(false)}>Avbryt</Button>
            <Button
              disabled={!templateName.trim()}
              onClick={() => {
                const items = pendingTemplateItems
                  .filter(i => !i.parent_id)
                  .flatMap(parent => {
                    const children = pendingTemplateItems.filter(c => c.parent_id === parent.id);
                    return [
                      { label: parent.label },
                      ...children.map(c => ({ label: c.label, parent_label: parent.label })),
                    ];
                  });
                createChecklistTemplate({ name: templateName.trim(), items });
                setTemplateDialogOpen(false);
              }}
            >
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default TicketDetail;
