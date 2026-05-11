import { useState, useEffect, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Loader2, Key, Copy, Eye, Globe, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useApiKeys } from '@/hooks/useApiKeys';
import { useWebhooks, useWebhookDeliveries } from '@/hooks/useWebhooks';
import { Checkbox } from '@/components/ui/checkbox';

const WebhookDeliveriesPanel = memo(({ webhookId }: { webhookId: string }) => {
  const { deliveries, isLoading } = useWebhookDeliveries(webhookId);

  if (isLoading) return <div className="p-2"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  if (deliveries.length === 0) return <p className="text-xs text-muted-foreground p-2">Inga leveranser ännu.</p>;

  return (
    <div className="rounded border bg-muted/30 divide-y divide-border max-h-48 overflow-y-auto">
      {deliveries.slice(0, 20).map((d) => (
        <div key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
          <span className={`w-2 h-2 rounded-full ${d.response_code && d.response_code >= 200 && d.response_code < 300 ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="font-mono">{d.event}</span>
          <span className="text-muted-foreground ml-auto">
            {d.response_code || 'Err'} &middot; {d.created_at ? format(new Date(d.created_at), 'd MMM HH:mm', { locale: sv }) : '-'}
          </span>
        </div>
      ))}
    </div>
  );
});
WebhookDeliveriesPanel.displayName = 'WebhookDeliveriesPanel';

const IntegrationsTab = () => {
  const { apiKeys, createApiKey, deleteApiKey, isCreating: isCreatingApiKey } = useApiKeys();
  const { webhooks, createWebhook, updateWebhook, deleteWebhook, isCreating: isCreatingWebhook } = useWebhooks();

  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [deleteApiKeyId, setDeleteApiKeyId] = useState<string | null>(null);

  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([]);
  const [deleteWebhookId, setDeleteWebhookId] = useState<string | null>(null);
  const [viewDeliveriesId, setViewDeliveriesId] = useState<string | null>(null);

  const [emailInboundStatus, setEmailInboundStatus] = useState<{
    configured: boolean;
    active: boolean;
    host: string | null;
    user: string | null;
    polling_interval: number;
    auto_create_contact: boolean;
  } | null>(null);

  const [sectionsOpen, setSectionsOpen] = useState({
    apiKeys: false,
    webhooks: false,
    emailInbound: false,
  });

  useEffect(() => {
    api.request('/email-inbound/status').then(setEmailInboundStatus).catch(() => {});
  }, []);

  return (
    <>
        <Collapsible open={sectionsOpen.apiKeys} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, apiKeys: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5" />
                  API-nycklar
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.apiKeys ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Skapa och hantera API-nycklar för extern integration.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Nyckelnamn (t.ex. CI/CD)"
                    value={newApiKeyName}
                    onChange={(e) => setNewApiKeyName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newApiKeyName.trim()) {
                        createApiKey({ name: newApiKeyName.trim() }).then((result) => {
                          if (result.key) {
                            setCreatedApiKey(result.key);
                          }
                          setNewApiKeyName('');
                          toast.success('API-nyckel skapad');
                        }).catch(() => toast.error('Kunde inte skapa nyckel'));
                      }
                    }}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => {
                      if (!newApiKeyName.trim()) { toast.error('Ange ett namn'); return; }
                      createApiKey({ name: newApiKeyName.trim() }).then((result) => {
                        if (result.key) {
                          setCreatedApiKey(result.key);
                        }
                        setNewApiKeyName('');
                        toast.success('API-nyckel skapad');
                      }).catch(() => toast.error('Kunde inte skapa nyckel'));
                    }}
                    disabled={isCreatingApiKey}
                  >
                    {isCreatingApiKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  </Button>
                </div>

                {createdApiKey && (
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-2">
                    <p className="text-sm font-medium text-yellow-400">Kopiera nyckeln nu — den visas bara en gång!</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs bg-background/50 p-2 rounded font-mono break-all">{createdApiKey}</code>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          navigator.clipboard.writeText(createdApiKey);
                          toast.success('Kopierad till urklipp');
                        }}
                        aria-label="Kopiera API-nyckel"
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setCreatedApiKey(null)}>Stäng</Button>
                  </div>
                )}

                <div className="divide-y divide-border rounded-md border">
                  {apiKeys.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">Inga API-nycklar skapade.</p>
                  )}
                  {apiKeys.map((key) => (
                    <div key={key.id} className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{key.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">itk_live_{key.key_prefix}...</p>
                        {key.last_used_at && (
                          <p className="text-xs text-muted-foreground">
                            Senast använd: {format(new Date(key.last_used_at), 'd MMM yyyy HH:mm', { locale: sv })}
                          </p>
                        )}
                      </div>
                      <Button size="icon" variant="ghost" onClick={() => setDeleteApiKeyId(key.id)} aria-label={`Ta bort API-nyckeln ${key.name}`}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.emailInbound} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, emailInbound: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="w-5 h-5" />
                  E-post-ingång
                  {emailInboundStatus?.configured && (
                    <Badge variant={emailInboundStatus.active ? 'default' : 'secondary'} className="ml-2">
                      {emailInboundStatus.active ? 'Aktiv' : 'Konfigurerad'}
                    </Badge>
                  )}
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.emailInbound ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Skapa ärenden automatiskt från inkommande e-post via IMAP.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                {emailInboundStatus?.configured ? (
                  <div className="space-y-3">
                    <div className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">IMAP-server</span>
                        <span className="text-sm font-mono">{emailInboundStatus.host}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Användare</span>
                        <span className="text-sm font-mono">{emailInboundStatus.user}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Pollningsintervall</span>
                        <span className="text-sm">{emailInboundStatus.polling_interval}s</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Skapa kontakt automatiskt</span>
                        <Badge variant={emailInboundStatus.auto_create_contact ? 'default' : 'secondary'}>
                          {emailInboundStatus.auto_create_contact ? 'Ja' : 'Nej'}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Olästa e-postmeddelanden hämtar och skapar ärenden automatiskt. Avsändaren matchas mot befintliga kontakter.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      E-post-ingång är inte konfigurerad. Ange följande miljövariabler på servern:
                    </p>
                    <div className="rounded-md border p-3 space-y-1 font-mono text-xs">
                      <p>IMAP_HOST=imap.example.com</p>
                      <p>IMAP_PORT=993</p>
                      <p>IMAP_USER=support@example.com</p>
                      <p>IMAP_PASS=***</p>
                      <p>IMAP_SECURE=true</p>
                      <p>IMAP_POLL_INTERVAL=60</p>
                      <p>IMAP_AUTO_CREATE_CONTACT=true</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.webhooks} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, webhooks: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Globe className="w-5 h-5" />
                  Webhooks
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.webhooks ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Skicka automatiska HTTP-anrop vid ärendehändelser.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <div className="space-y-3 rounded-md border p-3">
                  <Input
                    placeholder="Webhook URL (https://...)"
                    value={newWebhookUrl}
                    onChange={(e) => setNewWebhookUrl(e.target.value)}
                  />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Händelser</p>
                    <div className="flex flex-wrap gap-3">
                      {['ticket.created', 'ticket.updated', 'ticket.closed', '*'].map((evt) => (
                        <label key={evt} className="flex items-center gap-1.5 text-sm">
                          <Checkbox
                            checked={newWebhookEvents.includes(evt)}
                            onCheckedChange={(checked) => {
                              setNewWebhookEvents(prev =>
                                checked ? [...prev, evt] : prev.filter(e => e !== evt)
                              );
                            }}
                          />
                          {evt === '*' ? 'Alla' : evt}
                        </label>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!newWebhookUrl.trim()) { toast.error('Ange en URL'); return; }
                      if (newWebhookEvents.length === 0) { toast.error('Välj minst en händelse'); return; }
                      createWebhook({ url: newWebhookUrl.trim(), events: newWebhookEvents }).then(() => {
                        setNewWebhookUrl('');
                        setNewWebhookEvents([]);
                        toast.success('Webhook skapad');
                      }).catch(() => toast.error('Kunde inte skapa webhook'));
                    }}
                    disabled={isCreatingWebhook}
                  >
                    {isCreatingWebhook ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Skapa webhook
                  </Button>
                </div>

                <div className="divide-y divide-border rounded-md border">
                  {webhooks.length === 0 && (
                    <p className="p-3 text-sm text-muted-foreground">Inga webhooks konfigurerade.</p>
                  )}
                  {webhooks.map((wh) => {
                    const events = (() => { try { return JSON.parse(wh.events) as string[]; } catch { return []; } })();
                    return (
                      <div key={wh.id} className="p-3 space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono truncate">{wh.url}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {events.map((evt) => (
                                <Badge key={evt} variant="secondary" className="text-xs">{evt}</Badge>
                              ))}
                            </div>
                            {wh.last_triggered_at && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Senast: {format(new Date(wh.last_triggered_at), 'd MMM yyyy HH:mm', { locale: sv })}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Switch
                              checked={!!wh.active}
                              onCheckedChange={(checked) => {
                                updateWebhook({ id: wh.id, active: checked }).catch(() => toast.error('Kunde inte uppdatera'));
                              }}
                            />
                            <Button size="icon" variant="ghost" onClick={() => setViewDeliveriesId(viewDeliveriesId === wh.id ? null : wh.id)} aria-label={`Visa leveranshistorik för webhook ${wh.url}`}>
                              <Eye className="w-4 h-4 text-muted-foreground" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => setDeleteWebhookId(wh.id)} aria-label={`Ta bort webhook ${wh.url}`}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                        {viewDeliveriesId === wh.id && <WebhookDeliveriesPanel webhookId={wh.id} />}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

      <AlertDialog open={!!deleteApiKeyId} onOpenChange={() => setDeleteApiKeyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort API-nyckel?</AlertDialogTitle>
            <AlertDialogDescription>
              Nyckeln slutar fungera omedelbart. Denna åtgärd kan inte ångras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteApiKeyId) {
                  deleteApiKey(deleteApiKeyId).then(() => {
                    toast.success('API-nyckel borttagen');
                    setDeleteApiKeyId(null);
                  }).catch(() => toast.error('Kunde inte ta bort nyckel'));
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteWebhookId} onOpenChange={() => setDeleteWebhookId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              Webhooken och dess leveranshistorik raderas permanent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteWebhookId) {
                  deleteWebhook(deleteWebhookId).then(() => {
                    toast.success('Webhook borttagen');
                    setDeleteWebhookId(null);
                  }).catch(() => toast.error('Kunde inte ta bort webhook'));
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default IntegrationsTab;
