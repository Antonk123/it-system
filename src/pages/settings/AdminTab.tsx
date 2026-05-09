import { useState, useCallback, useRef } from 'react';
import { useSystemUsers } from '@/hooks/useSystemUsers';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
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
import { Trash2, Users, Mail, Shield, Loader2, HardDriveDownload, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';

const AdminTab = () => {
  const { users: systemUsers, isLoading: usersLoading, error: usersError, inviteUser, deleteUser, updateRole } = useSystemUsers();
  const { user: currentUser } = useAuth();

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [isInviting, setIsInviting] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreFileRef = useRef<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sectionsOpen, setSectionsOpen] = useState({
    users: false,
    backup: false,
  });

  const handleBackup = useCallback(async () => {
    setBackupLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      const response = await fetch(`${baseUrl}/backup`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) throw new Error('Backup failed');
      const blob = await response.blob();
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
      const token = localStorage.getItem('auth_token');
      const baseUrl = import.meta.env.VITE_API_URL || '/api';
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${baseUrl}/backup/restore`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data.error || 'Återställning misslyckades');
        return;
      }
      toast.success(data.message || 'Backup återställd');
    } catch {
      toast.error('Återställning misslyckades. Kontrollera filen och försök igen.');
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
      await deleteUser(deleteUserId);
      setDeleteUserId(null);
    }
  };

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

            <div className="border rounded-lg divide-y">
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
                  <div key={sysUser.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{sysUser.displayName || sysUser.email}</span>
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
                      </div>
                      {sysUser.displayName && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {sysUser.email}
                        </p>
                      )}
                      {sysUser.lastSignIn && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Senaste inloggning: {format(new Date(sysUser.lastSignIn), 'PPp', { locale: sv })}
                        </p>
                      )}
                    </div>
                    {sysUser.id !== currentUser?.id && (
                      <div className="flex items-center gap-1">
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
                          onClick={() => setDeleteUserId(sysUser.id)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    )}
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
            <AlertDialogAction onClick={handleRestore} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Återställ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteUserId} onOpenChange={() => setDeleteUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort användare?</AlertDialogTitle>
            <AlertDialogDescription>
              Denna åtgärd kan inte ångras. Användaren kommer att förlora tillgång till systemet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default AdminTab;
