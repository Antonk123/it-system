import { useState } from 'react';
import { Layout } from '@/components/Layout';
import { TemplateEditorModal } from '@/components/TemplateEditorModal';
import { useCategories } from '@/hooks/useCategories';
import { useTemplates } from '@/hooks/useTemplates';
import { useSystemUsers } from '@/hooks/useSystemUsers';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { Plus, Pencil, Trash2, Check, X, Tag, Users, Mail, Shield, Loader2, ArrowUp, ArrowDown, Palette, Type } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { FONT_OPTIONS, FontTheme, applyFontTheme, getStoredFontTheme, isFontTheme, saveFontTheme } from '@/lib/appearance';

const themeOptions = [
  { value: 'theme-midnight', label: 'Midnatt' },
  { value: 'theme-default', label: 'Standard' },
  { value: 'theme-slate', label: 'Skiffer' },
  { value: 'theme-forest', label: 'Skog' },
] as const;

const Settings = () => {
  const { categories, addCategory, updateCategory, deleteCategory, reorderCategories } = useCategories();
  const { templates, addTemplate, updateTemplate, deleteTemplate, reorderTemplates } = useTemplates();
  const { users: systemUsers, isLoading: usersLoading, error: usersError, inviteUser, deleteUser, updateRole } = useSystemUsers();
  const { user: currentUser } = useAuth();
  const { theme, setTheme } = useTheme();

  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [isInviting, setIsInviting] = useState(false);
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [fontTheme, setFontTheme] = useState<FontTheme>(getStoredFontTheme());

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) {
      toast.error('Ange ett kategorinamn');
      return;
    }
    addCategory(newCategoryName.trim());
    setNewCategoryName('');
    toast.success('Kategori tillagd');
  };

  const handleStartEdit = (id: string, label: string) => {
    setEditingId(id);
    setEditingName(label);
  };

  const handleSaveEdit = () => {
    if (!editingName.trim()) {
      toast.error('Kategorinamnet kan inte vara tomt');
      return;
    }
    if (editingId) {
      updateCategory(editingId, editingName.trim());
      setEditingId(null);
      setEditingName('');
      toast.success('Kategori uppdaterad');
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleDeleteCategory = (id: string) => {
    deleteCategory(id);
    toast.success('Kategori borttagen');
  };

  const handleMoveCategory = (id: string, direction: 'up' | 'down') => {
    const index = categories.findIndex((cat) => cat.id === id);
    if (index === -1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categories.length) return;

    const reordered = [...categories];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    reorderCategories(reordered.map((cat) => cat.id));
  };

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
    <Layout>
      <div className="max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">Inställningar</h1>

        {/* Appearance Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="w-5 h-5" />
              Utseende
            </CardTitle>
            <CardDescription>
              Justera tema och teckensnitt för hela sidan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
        </Card>

        {/* System Users Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Systemanvändare
            </CardTitle>
            <CardDescription>
              Hantera användare som har tillgång att logga in i systemet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Invite new user */}
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

            {/* Users list */}
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
        </Card>

        {/* Categories Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="w-5 h-5" />
              Kategorier
            </CardTitle>
            <CardDescription>
              Hantera ärendekategorier. Ändringar gäller för nya ärenden.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add new category */}
            <div className="flex gap-2">
              <Input
                placeholder="Nytt kategorinamn..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
              />
              <Button onClick={handleAddCategory} className="shrink-0">
                <Plus className="w-4 h-4 mr-2" />
                Lägg till
              </Button>
            </div>

            {/* Category list */}
            <div className="border rounded-lg divide-y">
              {categories.map((category) => (
                <div key={category.id} className="flex items-center gap-3 p-3">
                  {editingId === category.id ? (
                    <>
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="flex-1"
                        autoFocus
                      />
                      <Button size="icon" variant="ghost" onClick={handleSaveEdit}>
                        <Check className="w-4 h-4 text-green-500" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={handleCancelEdit}>
                        <X className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 font-medium">{category.label}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleMoveCategory(category.id, 'up')}
                          disabled={categories[0]?.id === category.id}
                        >
                          <ArrowUp className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleMoveCategory(category.id, 'down')}
                          disabled={categories[categories.length - 1]?.id === category.id}
                        >
                          <ArrowDown className="w-4 h-4 text-muted-foreground" />
                        </Button>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleStartEdit(category.id, category.label)}
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDeleteCategory(category.id)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
              {categories.length === 0 && (
                <div className="p-4 text-center text-muted-foreground">
                  Inga kategorier ännu. Lägg till en ovan.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Templates Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Type className="w-5 h-5" />
              Ärendemallar
            </CardTitle>
            <CardDescription>
              Hantera mallar för snabbare ärendeskapande. Mallar kan användas vid skapande av nya ärenden.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add new template button */}
            <Button
              onClick={() => {
                setEditingTemplate(null);
                setTemplateModalOpen(true);
              }}
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Ny mall
            </Button>

            {/* Template list */}
            <div className="border rounded-lg divide-y">
              {templates.map((template, index) => (
                <div key={template.id} className="flex items-center gap-3 p-3">
                  <div className="flex-1">
                    <p className="font-medium">{template.name}</p>
                    {template.description && (
                      <p className="text-sm text-muted-foreground">{template.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (index > 0) {
                          const newOrder = [...templates];
                          [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                          reorderTemplates(newOrder.map(t => t.id));
                        }
                      }}
                      disabled={index === 0}
                    >
                      <ArrowUp className="w-4 h-4 text-muted-foreground" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        if (index < templates.length - 1) {
                          const newOrder = [...templates];
                          [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
                          reorderTemplates(newOrder.map(t => t.id));
                        }
                      }}
                      disabled={index === templates.length - 1}
                    >
                      <ArrowDown className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditingTemplate(template);
                      setTemplateModalOpen(true);
                    }}
                  >
                    <Pencil className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteTemplate(template.id)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {templates.length === 0 && (
                <div className="p-4 text-center text-muted-foreground">
                  Inga mallar ännu. Klicka på "Ny mall" ovan för att skapa din första mall.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delete user confirmation dialog */}
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

      {/* Template Editor Modal */}
      <TemplateEditorModal
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        template={editingTemplate}
        categories={categories}
        onSave={addTemplate}
        onUpdate={updateTemplate}
      />
    </Layout>
  );
};

export default Settings;
