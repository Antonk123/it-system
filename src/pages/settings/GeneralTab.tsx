import { useState, useCallback, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Palette, Type, Bell, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { FONT_OPTIONS, FontTheme, applyFontTheme, getStoredFontTheme, isFontTheme, saveFontTheme, ModeTheme, applyMode, getStoredMode, saveModeTheme } from '@/lib/appearance';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';

const themeOptions = [
  { value: 'theme-default', label: 'Slate' },
  { value: 'theme-midnight', label: 'Midnight' },
  { value: 'theme-graphite', label: 'Graphite' },
  { value: 'theme-stone', label: 'Stone' },
  { value: 'theme-linear', label: 'Linear' },
  { value: 'theme-spotify', label: 'Spotify' },
] as const;

const GeneralTab = () => {
  const { theme, setTheme } = useTheme();
  const [fontTheme, setFontTheme] = useState<FontTheme>(getStoredFontTheme());
  const [mode, setMode] = useState<ModeTheme>(getStoredMode());
  const [pushLoading, setPushLoading] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBlocked, setPushBlocked] = useState(false);
  const [pushUnsupported, setPushUnsupported] = useState(false);
  const [iosNotInstalled, setIosNotInstalled] = useState(false);

  const [sectionsOpen, setSectionsOpen] = useState({
    appearance: true,
    notifications: false,
  });

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushUnsupported(true);
      return;
    }

    const isIos = /iPhone|iPad/.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    if (isIos && !isStandalone) {
      setIosNotInstalled(true);
    }

    if (Notification.permission === 'denied') {
      setPushBlocked(true);
      return;
    }

    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setPushEnabled(true);
      });
    });
  }, []);

  const handlePushToggle = useCallback(async (checked: boolean) => {
    setPushLoading(true);
    try {
      if (checked) {
        const permission = await Notification.requestPermission();
        if (permission === 'denied') {
          setPushBlocked(true);
          toast.error('Webbläsaren blockerade notiser. Tillåt notiser i webbläsarens inställningar.');
          return;
        }
        if (permission !== 'granted') {
          return;
        }

        const reg = await navigator.serviceWorker.ready;
        const { vapidPublicKey } = await api.getPushVapidKey();

        const padding = '='.repeat((4 - (vapidPublicKey.length % 4)) % 4);
        const base64 = (vapidPublicKey + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(base64);
        const applicationServerKey = Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));

        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        await api.subscribePush(subscription.toJSON());
        setPushEnabled(true);
        toast.success('Push-notiser aktiverade');
      } else {
        const reg = await navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.getSubscription();
        if (subscription) {
          const endpoint = subscription.endpoint;
          await subscription.unsubscribe();
          await api.unsubscribePush(endpoint);
        }
        setPushEnabled(false);
        toast.success('Push-notiser avaktiverade');
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Push toggle error:', error);
      toast.error('Kunde inte aktivera notiser. Försök igen.');
    } finally {
      setPushLoading(false);
    }
  }, []);

  const handleThemeChange = (value: string) => {
    setTheme(value);
    toast.success('Tema uppdaterat');
  };

  const handleFontThemeChange = (value: string) => {
    if (!isFontTheme(value)) {
      return;
    }
    const nextFontTheme = value as FontTheme;
    setFontTheme(nextFontTheme);
    applyFontTheme(nextFontTheme);
    saveFontTheme(nextFontTheme);
    toast.success('Teckensnitt uppdaterat');
  };

  return (
    <>
        <Collapsible open={sectionsOpen.appearance} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, appearance: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  Utseende
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.appearance ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Justera tema och teckensnitt för hela sidan.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="mode-toggle" className="text-sm font-medium">
                  Ljust läge
                </Label>
                <Switch
                  id="mode-toggle"
                  checked={mode === "light"}
                  onCheckedChange={(checked) => {
                    const newMode = checked ? "light" : "dark";
                    setMode(newMode);
                    applyMode(newMode);
                    saveModeTheme(newMode);
                    toast.success(checked ? "Bytte till ljust läge" : "Bytte till mörkt läge");
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Växla mellan ljust och mörkt läge
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tema</label>
              <Select value={theme || 'theme-midnight'} onValueChange={handleThemeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj tema" />
                </SelectTrigger>
                <SelectContent>
                  {themeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <Type className="w-4 h-4" />
                Teckensnitt
              </label>
              <Select value={fontTheme} onValueChange={handleFontThemeChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Välj teckensnitt" />
                </SelectTrigger>
                <SelectContent>
                  {FONT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.notifications} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, notifications: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Notifikationer
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.notifications ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Ta emot push-notiser för påminnelser och inaktiva ärenden direkt i webbläsaren.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                {iosNotInstalled && (
                  <div className="rounded-md p-3 text-sm" style={{ backgroundColor: 'hsl(45 93% 47% / 0.15)' }}>
                    Push-notiser fungerar bara när appen är installerad. Lägg till appen på hemskärmen för att aktivera.
                  </div>
                )}

                {pushBlocked && (
                  <div className="rounded-md bg-destructive/20 p-3 text-sm">
                    Notiser är blockerade i webbläsaren. Gå till webbläsarens inställningar och tillåt notiser för den här sidan.
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label htmlFor="push-toggle">Push-notiser</Label>
                    <p className="text-sm text-muted-foreground">
                      {pushBlocked ? 'Blockerade i webbläsaren' :
                       pushUnsupported ? 'Stöds inte i den här webbläsaren' :
                       pushEnabled ? 'Aktiverade' : 'Avaktiverade'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {pushLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                    <Switch
                      id="push-toggle"
                      checked={pushEnabled}
                      onCheckedChange={handlePushToggle}
                      disabled={pushLoading || pushBlocked || pushUnsupported || iosNotInstalled}
                    />
                  </div>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
    </>
  );
};

export default GeneralTab;
