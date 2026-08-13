import { useState, useCallback, useRef } from 'react';
import { useSystemUsers } from '@/hooks/useSystemUsers';
import { useAuth } from '@/contexts/AuthContext';
import { parseServerDate } from '@/lib/date';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
} from '@/components/ui/alert-dialog';
import { Trash2, Users, Mail, Shield, Loader2, HardDriveDownload, Upload, ScrollText, KeyRound, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { BackupScheduleSection } from '@/components/settings/BackupScheduleSection';
import { AuditLogSection } from '@/components/settings/AuditLogSection';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

const AdminTab = () => {
  const { users: systemUsers, isLoading: usersLoading, error: usersError, inviteUser, deleteUser, updateRole, clearSsoLink } = useSystemUsers();
  const { user: currentUser } = useAuth();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [isInviting, setIsInviting] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  // Label sparas med id:t så bekräftelsedialogen kan namnge kontot även efter
  // att listan hunnit refetchas.
  const [unlinkSso, setUnlinkSso] = useState<{ id: string; label: string } | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Frånkopplings- och borttagnings-dialogerna är state-styrda (ingen
  // AlertDialogTrigger), så Radix egen triggerRef är null och fokus skulle
  // landa på <body> när de stängs. Vi håller därför reda på knappen som
  // öppnade respektive dialog själva, plus en delad fallback-container att
  // lämna fokus till när knappen försvunnit ur DOM:en.
  const unlinkTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const userListRef = useRef<HTMLDivElement>(null);
  // Sätts efter en LYCKAD frånkoppling/borttagning (aldrig innan await:en är
  // klar) — annars flyttar även ett misslyckat anrop fokus till fallback-
  // containern trots att knappen fortfarande finns kvar i DOM:en.
  const unlinkConfirmedRef = useRef(false);
  const deleteConfirmedRef = useRef(false);

  const [sectionsOpen, setSectionsOpen] = useState({
    users: false,
    backup: false,
    auditLog: false,
  });

  const handleBackup = useCallback(async () => {
    setBackupLoading(true);
    try {
      const blob = await api.downloadBackup();
      const sizeMB = (blob.size / (1024 * 1024)).toFixed(1);
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `it-ticket-backup-${dateStr}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Backup skapad — ${filename} (${sizeMB} MB)`);
    } catch {
      toast.error('Backup misslyckades. Kontrollera servern och försök igen.');
    } finally {
      setBackupLoading(false);
    }
  }, []);

  const handleRestoreSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.zip')) {
      toast.error('Välj en giltig backup-ZIP-fil');
      return;
    }
    restoreFileRef.current = file;
    setConfirmRestore(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRestore = useCallback(async () => {
    const file = restoreFileRef.current;
    if (!file) return;
    setConfirmRestore(false);
    setRestoreLoading(true);
    try {
      const data = await api.uploadFile<{ message?: string; error?: string }>('/backup/restore', file);
      toast.success(data.message || 'Backup återställd');
    } catch (err: any) {
      toast.error(err?.message || 'Återställning misslyckades. Kontrollera filen och försök igen.');
    } finally {
      setRestoreLoading(false);
      restoreFileRef.current = null;
    }
  }, []);

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) {
      toast.error('Ange en e-postadress');
      return;
    }

    setIsInviting(true);
    const success = await inviteUser(inviteEmail.trim(), inviteRole, inviteName.trim() || undefined);
    if (success) {
      setInviteEmail('');
      setInviteName('');
      setInviteRole('user');
    }
    setIsInviting(false);
  };

  const handleDeleteUser = async () => {
    if (deleteUserId) {
      // Radix stänger dialogen själv via onOpenChange när AlertDialogAction
      // klickas — därför behövs ingen extra state-städning här utöver flaggan.
      // Flaggan sätts EFTER await och bara vid lyckad borttagning: sätts den
      // före (eller ovillkorligt) skulle ett misslyckat anrop ändå flytta
      // fokus till fallback-containern trots att knappen finns kvar.
      const success = await deleteUser(deleteUserId);
      if (success) {
        deleteConfirmedRef.current = true;
      }
      setDeleteUserId(null);
    }
  };

  const handleClearSsoLink = async () => {
    if (unlinkSso) {
      // Flaggan sätts EFTER await och bara vid lyckad frånkoppling — sätts den
      // före (eller ovillkorligt) skulle ett misslyckat anrop ändå flytta
      // fokus till fallback-containern trots att knappen finns kvar.
      const success = await clearSsoLink(unlinkSso.id);
      if (success) {
        unlinkConfirmedRef.current = true;
      }
    }
  };

  // Lämnar tillbaka fokus när frånkopplings-dialogen stängs (bekräfta, Avbryt
  // eller Escape). Utan detta hamnar fokus på <body> och tangentbordsanvändaren
  // tappar sin plats i listan.
  const handleUnlinkDialogCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const trigger = unlinkTriggerRef.current;
    const shouldFallBackToList = unlinkConfirmedRef.current || !trigger?.isConnected;
    if (shouldFallBackToList) {
      userListRef.current?.focus();
    } else {
      trigger.focus();
    }
    unlinkTriggerRef.current = null;
    unlinkConfirmedRef.current = false;
  }, []);

  // Samma mönster som frånkopplings-dialogen: "Ta bort användare" är också
  // state-styrd utan AlertDialogTrigger, så utan detta hamnar fokus på <body>
  // när dialogen stängs.
  const handleDeleteDialogCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
    const trigger = deleteTriggerRef.current;
    const shouldFallBackToList = deleteConfirmedRef.current || !trigger?.isConnected;
    if (shouldFallBackToList) {
      userListRef.current?.focus();
    } else {
      trigger.focus();
    }
    deleteTriggerRef.current = null;
    deleteConfirmedRef.current = false;
  }, []);

  return (
    <>
        <Collapsible open={sectionsOpen.users} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, users: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Systemanvändare
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.users ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Hantera användare som har tillgång att logga in i systemet.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="text"
                placeholder="Visningsnamn (valfritt)"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                disabled={isInviting}
              />
              <Input
                type="email"
                placeholder="E-postadress för ny användare..."
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isInviting && handleInviteUser()}
                disabled={isInviting}
              />
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'admin' | 'user')} disabled={isInviting}>
                <SelectTrigger className="w-36 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Användare</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleInviteUser} className="shrink-0" disabled={isInviting}>
                {isInviting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4 mr-2" />
                )}
                Skapa
              </Button>
            </div>

            {/* tabIndex={-1}: fokusmål när "Koppla loss SSO"-knappen eller "Ta bort
                användare"-knappen försvinner ur DOM:en efter en lyckad åtgärd —
                annars faller fokus till <body>. Går inte att nå med Tab, bara
                programmatiskt. role="group" + aria-label ger den namnlösa
                fallback-containern ett tillgängligt namn för skärmläsare. */}
            <div
              ref={userListRef}
              tabIndex={-1}
              role="group"
              aria-label="Systemanvändare"
              className="border rounded-lg divide-y"
            >
              {usersLoading ? (
                <div className="p-4 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                  Laddar användare...
                </div>
              ) : usersError ? (
                <div className="p-4 text-center text-destructive">
                  {usersError}
                </div>
              ) : systemUsers.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  Inga systemanvändare hittades.
                </div>
              ) : (
                systemUsers.map((sysUser) => (
                  /* Staplad rad på mobil: åtgärdsklustret (upp till tre knappar)
                     är bredare än 390px-viewporten och tryckte annars ihop
                     namnkolumnen till 0px + gav hela sidan horisontell scroll.
                     Vänder till en rad först vid sm: (640px) — samma brytpunkt
                     som Tailwinds sm:, aldrig en JS-brytpunkt (dödzon-risk). */
                  <div key={sysUser.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                    <div className="flex-1 min-w-0">
                      {/* flex-wrap: badges får radbryta ner under namnet i stället för
                          att krympa namnet — annars klämdes kontots identitet till 0px
                          vid smala bredder (uppmätt vid exakt 640px). min-w-0 på namnet
                          är det som faktiskt låter truncate fungera: en flex-items
                          default min-width är "auto" (= textens fulla bredd för ett
                          white-space:nowrap-element som truncate ger), vilket annars
                          förhindrar all krympning. */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium truncate min-w-0">{sysUser.displayName || sysUser.email}</span>
                        {sysUser.role === 'admin' && (
                          <Badge variant="secondary" className="shrink-0">
                            <Shield className="w-3 h-3 mr-1" />
                            Admin
                          </Badge>
                        )}
                        {!sysUser.emailConfirmed && (
                          <Badge variant="outline" className="shrink-0 text-muted-foreground">
                            Väntar på bekräftelse
                          </Badge>
                        )}
                        {sysUser.ssoLinked && (
                          <Badge variant="outline" className="shrink-0">
                            <KeyRound className="w-3 h-3 mr-1" />
                            SSO-länkad
                          </Badge>
                        )}
                      </div>
                      {sysUser.displayName && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sysUser.email}
                        </p>
                      )}
                      {sysUser.lastSignIn && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Senaste inloggning: {format(parseServerDate(sysUser.lastSignIn), 'PPp', { locale: sv })}
                        </p>
                      )}
                    </div>
                    {/* Knapparna får radbrytas på mobil (flex-wrap) — på sm: och
                        uppåt hålls de ihop på en rad som förut. */}
                    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-1">
                      {/* Koppla loss går även på det egna kontot — det tar inte
                          bort åtkomsten (lösenordsinloggning finns kvar) och en
                          felaktig länkning måste gå att rätta oavsett vems den är. */}
                      {sysUser.ssoLinked && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            // Spara knappen så fokus kan lämnas tillbaka hit när
                            // dialogen stängs (Radix triggerRef är null här).
                            unlinkTriggerRef.current = e.currentTarget;
                            setUnlinkSso({ id: sysUser.id, label: sysUser.displayName || sysUser.email });
                          }}
                          // Alla rader har annars samma tillgängliga namn ("Koppla loss
                          // SSO") — skärmläsaranvändaren kan inte skilja dem åt. title
                          // räcker inte: den ignoreras när elementet redan har ett namn
                          // från sin text. Den synliga texten ingår i namnet (WCAG 2.5.3).
                          aria-label={`Koppla loss SSO för ${sysUser.displayName || sysUser.email}`}
                          title="Koppla loss kontot från dess SSO-identitet"
                        >
                          <Unlink className="w-3 h-3 mr-1" />
                          Koppla loss SSO
                        </Button>
                      )}
                      {sysUser.id !== currentUser?.id && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => updateRole(sysUser.id, sysUser.role === 'admin' ? 'user' : 'admin')}
                            title={sysUser.role === 'admin' ? 'Nedgradera till användare' : 'Uppgradera till admin'}
                          >
                            <Shield className="w-3 h-3 mr-1" />
                            {sysUser.role === 'admin' ? 'Ta bort admin' : 'Gör admin'}
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={(e) => {
                              // Spara knappen så fokus kan lämnas tillbaka hit när
                              // dialogen stängs (Radix triggerRef är null här) —
                              // samma mönster som frånkopplings-dialogen.
                              deleteTriggerRef.current = e.currentTarget;
                              setDeleteUserId(sysUser.id);
                            }}
                            aria-label={`Ta bort användare ${sysUser.displayName || sysUser.email}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.backup} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, backup: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <HardDriveDownload className="w-5 h-5" />
                  Backup &amp; Export
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.backup ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Ladda ned en komplett kopia av databasen och uppladdade filer som en ZIP-fil.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <BackupScheduleSection />
                <p className="text-sm text-muted-foreground">
                  ZIP-filen innehåller en WAL-säker ögonblicksbild av databasen samt alla uppladdade filer. Spara filen på en säker plats.
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={handleBackup}
                    disabled={backupLoading}
                  >
                    {backupLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <HardDriveDownload className="w-4 h-4 mr-2" />
                    )}
                    {backupLoading ? 'Genererar backup...' : 'Ladda ned backup'}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={handleRestoreSelect}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={restoreLoading}
                  >
                    {restoreLoading ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 mr-2" />
                    )}
                    {restoreLoading ? 'Återställer...' : 'Återställ backup'}
                  </Button>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        <Collapsible open={sectionsOpen.auditLog} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, auditLog: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <ScrollText className="w-5 h-5" />
                  Granskningslogg
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.auditLog ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Historik över känsliga åtgärder i systemet — inloggningar, användarändringar, fakturor med mera.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                <AuditLogSection />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Återställ från backup?</AlertDialogTitle>
            <AlertDialogDescription>
              All nuvarande data ersätts med backupens innehåll. En säkerhetskopia av aktuell databas sparas automatiskt. Servern måste startas om efteråt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore} className={buttonVariants({ variant: 'destructive' })}>
              Återställ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteUserId} onOpenChange={() => setDeleteUserId(null)}>
        <AlertDialogContent onCloseAutoFocus={handleDeleteDialogCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort användare?</AlertDialogTitle>
            <AlertDialogDescription>
              Denna åtgärd kan inte ångras. Användaren kommer att förlora tillgång till systemet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className={buttonVariants({ variant: 'destructive' })}>
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!unlinkSso} onOpenChange={() => setUnlinkSso(null)}>
        <AlertDialogContent onCloseAutoFocus={handleUnlinkDialogCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Koppla loss SSO-länken?</AlertDialogTitle>
            <AlertDialogDescription>
              {unlinkSso?.label} kopplas loss från sin nuvarande SSO-identitet och loggas
              samtidigt ut ur alla aktiva sessioner. Nästa gång någon loggar in med SSO mot
              samma e-postadress länkas kontot om till den identitet som loggar in då. Använd
              detta när adressen bytt ägare eller när en länkning blivit fel. Inloggning med
              lösenord fungerar fortfarande.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearSsoLink} className={buttonVariants({ variant: 'destructive' })}>
              Koppla loss
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AdminTab;
