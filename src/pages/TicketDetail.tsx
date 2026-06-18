import { useEffect, useState, useRef } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { ArrowLeft, Pencil, Trash2, Clock, User as UserIcon, Calendar, FileText, Lightbulb, Paperclip, Download, Share2, Copy, Link as LinkIcon, Loader2, ListChecks, Plus, Camera, Sparkles, RefreshCw, Check, X, MoreVertical, Bell } from 'lucide-react';
import { useTickets, ticketKeys } from '@/hooks/useTickets';
import { useCategories } from '@/hooks/useCategories';
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
import TimeSection from '@/components/TimeSection';
import { TicketActivity } from '@/components/TicketActivity';
import { ReminderDialog } from '@/components/ReminderDialog';
import { ReminderList } from '@/components/ReminderList';
import { Layout } from '@/components/Layout';
import { StatusBadge } from '@/components/StatusBadge';
import { PriorityBadge } from '@/components/PriorityBadge';
import { SLABadge } from '@/components/SLABadge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { TicketStatus } from '@/types/ticket';
import { api } from '@/lib/api';
import { mapTicketRow } from '@/lib/mapTicket';
import { STATUS_LABELS } from '@/lib/constants';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const formatFileSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const TicketDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { getTicketById, updateTicket, deleteTicket, isLoading: ticketsLoading } = useTickets();

  // Authoritative single-ticket query — preferred over paginated list cache
  // which may be stale or filtered out.
  const { data: ticketDetail, isLoading: ticketDetailLoading } = useQuery({
    queryKey: ticketKeys.detail(id || ''),
    queryFn: () => api.getTicket(id!),
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 2,
  });
  const { getCategoryLabel } = useCategories();
  const { getUserById } = useUsers();
  const { attachments, fetchAttachments } = useTicketAttachments();
  const { items: checklistItems, fetchChecklists, addChecklistItem, updateChecklistItem, deleteChecklistItem, setItems: setChecklistItems } = useTicketChecklists();
  const { templates: checklistTemplates, fetchTemplates: fetchChecklistTemplates, createTemplate: createChecklistTemplate, applyTemplate: applyChecklistTemplate } = useChecklistTemplates();
  const { comments, isLoading: commentsLoading, isError: commentsError, addComment, updateComment, deleteComment } = useTicketComments(id || '');
  const { links, isLoading: linksLoading, isError: linksError, addLink, deleteLink } = useTicketLinks(id || '');
  // Defer non-critical, below-the-fold data until the browser is idle after the
  // first paint, so it doesn't compete with the ticket + comments fetch on a
  // slow link (VPN/5G).
  const [deferSecondary, setDeferSecondary] = useState(false);
  const { history, isLoading: historyLoading } = useTicketHistory(id || '', deferSecondary);
  const { reminders, fetchReminders, createReminder, deleteReminder, clearSentReminders } = useTicketReminders(id || '');
  const {
    isLoading: isShareLoading,
    shareUrl,
    createShareLink,
    copyToClipboard,
    getExistingShare,
    setShareUrl
  } = useTicketSharing();
  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [mobileReminderOpen, setMobileReminderOpen] = useState(false);
  const [mobileDeleteOpen, setMobileDeleteOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [pendingTemplateItems, setPendingTemplateItems] = useState<ChecklistItem[]>([]);
  const [aiCategoryDismissed, setAiCategoryDismissed] = useState(false);
  const [aiSummary, setAiSummary] = useState<{ status: string; blockers: string; lastAction: string } | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiDraftKbTitles, setAiDraftKbTitles] = useState<string[]>([]);
  const [aiDraftAttachments, setAiDraftAttachments] = useState<string[]>([]);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);

  const hasVisibleContent = (html: string | null | undefined): boolean => {
    if (!html) return false;
    return html.replace(/<[^>]*>/g, '').trim().length > 0;
  };
  const [ticketFieldValues, setTicketFieldValues] = useState<
    { field_name: string; field_label: string; field_value: string }[]
  >([]);
  const [tagsFromAPI, setTagsFromAPI] = useState<{ id: string; name: string; color: string }[]>([]);

  // Prefer authoritative single-ticket data; fall back to list cache for instant display.
  // ticketDetail is the primary source so ärenden outside the paginated page are found.
  const listTicket = id ? getTicketById(id) : null;
  const ticket = (ticketDetail ? mapTicketRow(ticketDetail) : null) ?? listTicket ?? null;
  const user = ticket ? getUserById(ticket.requesterId) : null;

  // Sync field_values and tags from the authoritative single-ticket query
  useEffect(() => {
    if (!ticketDetail) return;
    if (ticketDetail.field_values && ticketDetail.field_values.length > 0) {
      setTicketFieldValues(ticketDetail.field_values);
    }
    if (ticketDetail.tags) setTagsFromAPI(ticketDetail.tags);
  }, [ticketDetail]);

  // Tags to display — prefer fresh data from single-ticket query
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

  // Flip `deferSecondary` on once the browser is idle after first paint.
  useEffect(() => {
    const ric = (window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (h: number) => void;
    });
    let handle: number;
    if (ric.requestIdleCallback) {
      handle = ric.requestIdleCallback(() => setDeferSecondary(true));
      return () => ric.cancelIdleCallback?.(handle);
    }
    handle = window.setTimeout(() => setDeferSecondary(true), 800);
    return () => clearTimeout(handle);
  }, []);

  // Reminders back a section that only renders when data exists — safe to defer.
  useEffect(() => {
    if (id && deferSecondary) fetchReminders();
  }, [id, deferSecondary, fetchReminders]);

  // Checklist templates are only needed once the checklist UI is shown (it has
  // an "apply/save template" action). Don't fetch them for tickets without a
  // checklist on initial load. Fetch once when the section first becomes visible.
  const checklistVisible = checklistItems.length > 0 || checklistOpen;
  const templatesFetchedRef = useRef(false);
  useEffect(() => {
    if (checklistVisible && !templatesFetchedRef.current) {
      templatesFetchedRef.current = true;
      fetchChecklistTemplates();
    }
  }, [checklistVisible, fetchChecklistTemplates]);

  // Fetch AI summary for tickets with enough comments
  useEffect(() => {
    if (!id || comments.length < 5) return;
    let mounted = true;
    setAiSummaryLoading(true);
    api.getAiSummary(id).then((result) => {
      if (!mounted) return;
      if (result.summary) setAiSummary(result.summary);
    }).catch(() => {}).finally(() => { if (mounted) setAiSummaryLoading(false); });
    return () => { mounted = false; };
  }, [id, comments.length]);

  const handleRefreshAiSummary = () => {
    if (!id) return;
    setAiSummaryLoading(true);
    api.getAiSummary(id, true).then((result) => {
      if (result.summary) setAiSummary(result.summary);
    }).catch(() => {
      toast.error('Kunde inte uppdatera AI-sammanfattning');
    }).finally(() => setAiSummaryLoading(false));
  };

  const handleAcceptAiCategory = () => {
    if (!ticket?.ai_suggested_category_id) return;
    updateTicket(ticket.id, { category: ticket.ai_suggested_category_id });
    toast.success('Kategori accepterad');
  };

  const handleDismissAiCategory = () => {
    if (!ticket) return;
    setAiCategoryDismissed(true);
    api.dismissAiCategorySuggestion(ticket.id).catch(() => {});
  };

  const handleGenerateAiDraft = async () => {
    if (!id) return;
    setIsGeneratingDraft(true);
    try {
      const result = await api.generateAiDraft(id);
      setAiDraft(result.draft);
      setAiDraftKbTitles(result.kbTitles || []);
      setAiDraftAttachments(result.attachmentsUsed || []);
    } catch {
      toast.error('Kunde inte generera AI-utkast');
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handleUseDraftAsSolution = () => {
    if (!ticket || !aiDraft) return;
    updateTicket(ticket.id, { solution: aiDraft });
    setAiDraft(null);
    setAiDraftKbTitles([]);
    setAiDraftAttachments([]);
    toast.success('Lösning sparad');
  };

  // Track recently viewed tickets
  useEffect(() => {
    if (!ticket?.id || !ticket?.title) return;
    addRecentlyViewedTicket(ticket.id, ticket.title);
  }, [ticket?.id, ticket?.title]);

  // Show skeleton while loading: either list cache is loading, or
  // detail query is in-flight and there's no list-cache fallback yet.
  if (ticketsLoading || (ticketDetailLoading && !listTicket)) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-2/3" />
            <div className="flex gap-3">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </Layout>
    );
  }

  // At this point the loading guard above has handled the in-flight cases
  // (list cache loading, or detail query in-flight with no list-cache fallback).
  // Any remaining null ticket means the detail query has settled and returned
  // nothing (or the list-cache fallback was also absent) — show "not found".
  // This single guard also narrows `ticket` to non-null for all handlers below.
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
    updateTicket(ticket.id, { status })
      .then(() => toast.success(`Status uppdaterad till ${STATUS_LABELS[status]}`))
      .catch(() => toast.error('Kunde inte uppdatera status'));
  };

  const handleTagsChange = (tagIds: string[]) => {
    updateTicket(ticket.id, { tag_ids: tagIds }).then(() => {
      refreshTagsFromAPI(ticket.id);
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
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
      navigate('/tickets');
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !ticket) return;
    try {
      await api.uploadAttachment(ticket.id, file);
      fetchAttachments(ticket.id);
      toast.success('Foto uppladdat');
    } catch {
      toast.error('Kunde inte ladda upp foto');
    }
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  return (
    <Layout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          <Button
            variant="ghost"
            className="gap-2"
            onClick={handleBack}
            aria-label="Tillbaka"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Tillbaka</span>
          </Button>
          <div className="flex gap-2">
            {/* Desktop: alla knappar synliga */}
            <div className="hidden sm:flex gap-2">
              <Popover open={sharePopoverOpen} onOpenChange={setSharePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={handleShare}
                    disabled={isShareLoading}
                    aria-label="Dela"
                  >
                    {isShareLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Share2 className="w-4 h-4" />
                    )}
                    <span className="hidden sm:inline">Dela</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]" align="end">
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
                          aria-label="Kopiera delningslänk"
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

            {/* Mobil: Redigera + mer-meny */}
            <div className="flex sm:hidden gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => navigate(`/tickets/${ticket.id}/edit`, {
                  state: { from: location.state?.from || location.pathname + location.search }
                })}
                aria-label="Redigera ärende"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Fler åtgärder">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => { handleShare(); }}>
                    <Share2 className="w-4 h-4 mr-2" /> Dela
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setMobileReminderOpen(true)}>
                    <Bell className="w-4 h-4 mr-2" /> Påminn mig
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleClone}>
                    <Copy className="w-4 h-4 mr-2" /> Klona
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => setMobileDeleteOpen(true)}>
                    <Trash2 className="w-4 h-4 mr-2" /> Ta bort
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        {/* Mobil-styrda dialoger */}
        <ReminderDialog onCreateReminder={createReminder} open={mobileReminderOpen} onOpenChange={setMobileReminderOpen} />
        <AlertDialog open={mobileDeleteOpen} onOpenChange={setMobileDeleteOpen}>
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

        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h1 className="text-xl font-semibold leading-none tracking-tight mb-2">{ticket.title}</h1>
                <div className="flex items-center gap-3 flex-wrap">
                  <StatusBadge status={ticket.status} />
                  <PriorityBadge priority={ticket.priority} />
                  <CategoryBadge category={ticket.category} />
                  <SLABadge
                    deadline={ticket.sla_response_deadline}
                    met={ticket.sla_response_met}
                    pausedAt={ticket.sla_paused_at}
                    label="Svar"
                    ticketStatus={ticket.status}
                  />
                  <SLABadge
                    deadline={ticket.sla_resolution_deadline}
                    met={ticket.sla_resolution_met}
                    pausedAt={ticket.sla_paused_at}
                    label="Lösning"
                    ticketStatus={ticket.status}
                  />
                  {effectiveTags.length > 0 && (
                    <TagBadges tags={effectiveTags as any} maxDisplay={5} />
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* AI Category Suggestion Banner */}
            {ticket.ai_suggested_category_id && !ticket.category && !aiCategoryDismissed && (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--ai))]/30 bg-[hsl(var(--ai))]/5">
                <Sparkles className="w-4 h-4 text-[hsl(var(--ai))] shrink-0" />
                <p className="text-sm flex-1">
                  AI föreslår: <span className="font-medium">{getCategoryLabel(ticket.ai_suggested_category_id)}</span>
                  {ticket.ai_suggested_confidence && (
                    <span className="text-muted-foreground ml-1">
                      ({Math.round(ticket.ai_suggested_confidence * 100)}% säker)
                    </span>
                  )}
                </p>
                <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={handleAcceptAiCategory}>
                  <Check className="w-3 h-3" /> Acceptera
                </Button>
                <Button variant="ghost" size="sm" className="gap-1 text-xs h-7 text-muted-foreground" onClick={handleDismissAiCategory}>
                  <X className="w-3 h-3" /> Ignorera
                </Button>
              </div>
            )}

            {/* AI Summary Box */}
            {aiSummary && (
              <div className="rounded-lg border border-[hsl(var(--ai))]/20 bg-[hsl(var(--ai))]/5 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[hsl(var(--ai))] flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    AI-sammanfattning
                  </span>
                  <button
                    onClick={handleRefreshAiSummary}
                    disabled={aiSummaryLoading}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${aiSummaryLoading ? 'animate-spin' : ''}`} />
                    Uppdatera
                  </button>
                </div>
                <div className="grid gap-1.5 text-sm">
                  <p><span className="text-muted-foreground">Status:</span> {aiSummary.status}</p>
                  <p><span className="text-muted-foreground">Blockerare:</span> {aiSummary.blockers}</p>
                  <p><span className="text-muted-foreground">Senaste:</span> {aiSummary.lastAction}</p>
                </div>
              </div>
            )}

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
              <h2 className="font-medium text-foreground mb-2">Beskrivning</h2>
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
                  onClearSent={clearSentReminders}
                />
              </div>
            )}

            {/* Attachments */}
            {attachments.length > 0 && (
              <div className="pt-4 border-t">
                <div className="flex items-center gap-2 mb-3">
                  <Paperclip className="w-4 h-4 text-muted-foreground" />
                  <h2 className="font-medium text-foreground">
                    Bilagor ({attachments.length})
                  </h2>
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
              {(ticket as any).company_name && (
                <div className="flex items-center gap-3">
                  <UserIcon className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Företag</p>
                    <p className="font-medium">{(ticket as any).company_name}</p>
                  </div>
                </div>
              )}
              {(ticket as any).assigned_to_name && (
                <div className="flex items-center gap-3">
                  <UserIcon className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Tilldelad</p>
                    <p className="font-medium">{(ticket as any).assigned_to_name}</p>
                  </div>
                </div>
              )}
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

            {/* Solution + AI Draft */}
            <div className="pt-4 border-t">
              {hasVisibleContent(ticket.solution) ? (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-4 h-4 text-success" />
                    <h2 className="font-medium text-foreground">Lösning</h2>
                  </div>
                  <div className="bg-success/20 border border-success/40 p-4 rounded-lg">
                    <HtmlRenderer content={migrateContent(ticket.solution)} />
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-muted-foreground" />
                      <h2 className="font-medium text-foreground">Lösning</h2>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleGenerateAiDraft}
                      disabled={isGeneratingDraft}
                      className="gap-1.5 text-xs"
                      aria-label="Föreslå svar med AI"
                    >
                      {isGeneratingDraft ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      Föreslå svar (AI)
                    </Button>
                  </div>
                  {aiDraft && (
                    <div className="rounded-lg border border-[hsl(var(--ai))]/30 bg-[hsl(var(--ai))]/5 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[hsl(var(--ai))] flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3" />
                          AI-utkast — granska innan du sparar
                        </span>
                        <button onClick={() => { setAiDraft(null); setAiDraftKbTitles([]); }} className="text-muted-foreground hover:text-foreground">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <textarea
                        value={aiDraft}
                        onChange={(e) => setAiDraft(e.target.value)}
                        aria-label="AI-genererat förslag på svar"
                        className="w-full min-h-[120px] bg-background/50 border border-border rounded-md p-3 text-sm resize-y focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      />
                      {(aiDraftKbTitles.length > 0 || aiDraftAttachments.length > 0) && (
                        <p className="text-xs text-muted-foreground">
                          Baserat på: {[...aiDraftKbTitles, ...aiDraftAttachments.map(a => `📎 ${a}`)].join(', ')}
                        </p>
                      )}
                      <div className="flex justify-end">
                        <Button size="sm" onClick={handleUseDraftAsSolution} className="gap-1.5">
                          Spara som lösning
                        </Button>
                      </div>
                    </div>
                  )}
                  {!aiDraft && (
                    <p className="text-xs text-muted-foreground">Ingen lösning registrerad ännu.</p>
                  )}
                </div>
              )}
            </div>

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
                isError={commentsError}
                onAddComment={(content, isInternal) => addComment(content, isInternal).then(() => {})}
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

            {/* Tid — Time Tracking */}
            <div className="pt-4 border-t">
              <TimeSection ticketId={ticket.id} />
            </div>

            {/* Linked Tickets */}
            <div className="pt-4 border-t">
              <TicketLinks
                links={links}
                isLoading={linksLoading}
                isError={linksError}
                currentTicketId={ticket.id}
                onAddLink={(targetTicketId) => addLink(targetTicketId).then(() => {})}
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
            <DialogDescription>Ge mallen ett tydligt namn så du hittar den lätt senare.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="template-name">Namn på mallen</Label>
            <Input
              id="template-name"
              placeholder="T.ex. Lösenordsåterställning"
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
          </div>
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

      {/* Mobile quick actions — fixed bar above bottom tab bar */}
      <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] inset-x-0 md:hidden bg-card border-t p-2 flex gap-2 z-40">
        <Select value={ticket.status} onValueChange={(s) => handleStatusChange(s as TicketStatus)}>
          <SelectTrigger className="flex-1 h-10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['open', 'in-progress', 'waiting', 'resolved', 'closed'] as TicketStatus[]).map(s => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-10"
          onClick={() => navigate(`/tickets/${ticket.id}/edit`, {
            state: { from: location.state?.from || location.pathname + location.search, scrollTo: 'time' }
          })}
        >
          <Clock className="h-4 w-4 mr-1" /> Tid
        </Button>
        <label className="shrink-0">
          <Button size="sm" variant="outline" className="h-10 pointer-events-none" asChild>
            <span><Camera className="h-4 w-4 mr-1" /> Foto</span>
          </Button>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoUpload}
          />
        </label>
      </div>
    </Layout>
  );
};

export default TicketDetail;
