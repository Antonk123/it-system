import { useState } from 'react';
import { useTags } from '@/hooks/useTags';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Plus, Pencil, Trash2, Check, X, Tags } from 'lucide-react';
import { toast } from 'sonner';
const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6',
];

export function KBTagSettings() {
  const { tags, createTag, updateTag, deleteTag, isCreating: isCreatingTag } = useTags();
  const [sectionsOpen, setSectionsOpen] = useState({ tags: true });
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#3b82f6');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editingTagName, setEditingTagName] = useState('');
  const [editingTagColor, setEditingTagColor] = useState('');
  const [deleteTagId, setDeleteTagId] = useState<string | null>(null);
  const handleAddTag = async () => {
    if (!newTagName.trim()) {
      toast.error('Ange ett taggnamn');
      return;
    }
    try {
      await createTag({ name: newTagName.trim(), color: newTagColor });
      setNewTagName('');
      setNewTagColor('#3b82f6');
      toast.success('Tagg tillagd');
    } catch {
      toast.error('Kunde inte skapa tagg');
    }
  };

  const handleStartEditTag = (id: string, name: string, color: string) => {
    setEditingTagId(id);
    setEditingTagName(name);
    setEditingTagColor(color);
  };

  const handleSaveTagEdit = async () => {
    if (!editingTagName.trim()) {
      toast.error('Taggnamnet kan inte vara tomt');
      return;
    }
    if (editingTagId) {
      try {
        await updateTag({ id: editingTagId, name: editingTagName.trim(), color: editingTagColor });
        setEditingTagId(null);
        toast.success('Tagg uppdaterad');
      } catch {
        toast.error('Kunde inte uppdatera tagg');
      }
    }
  };

  const handleCancelTagEdit = () => {
    setEditingTagId(null);
    setEditingTagName('');
    setEditingTagColor('');
  };

  const handleDeleteTag = async () => {
    if (deleteTagId) {
      try {
        await deleteTag(deleteTagId);
        setDeleteTagId(null);
        toast.success('Tagg borttagen');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Kunde inte ta bort tagg');
      }
    }
  };

  return (<>
        <Collapsible open={sectionsOpen.tags} onOpenChange={(open) => setSectionsOpen(prev => ({ ...prev, tags: open }))}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="cursor-pointer hover:bg-primary/10 transition-colors">
                <CardTitle className="flex items-center gap-2">
                  <Tags className="w-5 h-5" />
                  Kunskapsbasens taggar
                  <span className="ml-auto text-sm text-muted-foreground">{sectionsOpen.tags ? '−' : '+'}</span>
                </CardTitle>
                <CardDescription>
                  Hantera taggar för artiklar i kunskapsbasen.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="min-w-0 basis-full sm:basis-0 flex-1">
                <Input
                  placeholder="Nytt taggnamn..."
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !isCreatingTag && handleAddTag()}
                  disabled={isCreatingTag}
                />
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    style={{ backgroundColor: newTagColor }}
                    className="w-10 h-10 rounded-md border border-border shrink-0 hover:opacity-80 transition-opacity"
                    title="Välj färg"
                  />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-3">
                  <p className="text-xs text-muted-foreground mb-2">Välj färg</p>
                  <div className="flex gap-2 flex-wrap max-w-[200px]">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewTagColor(color)}
                        style={{ backgroundColor: color }}
                        className={`w-7 h-7 rounded-full transition-all ${
                          newTagColor === color ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''
                        }`}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Button onClick={handleAddTag} className="min-h-11 shrink-0 whitespace-nowrap" disabled={isCreatingTag}>
                <Plus className="w-4 h-4 mr-2" />
                Lägg till
              </Button>
            </div>

            <div className="border rounded-lg divide-y">
              {tags.map((tag) => (
                <div key={tag.id} className="flex items-center gap-3 p-3">
                  {editingTagId === tag.id ? (
                    <>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            style={{ backgroundColor: editingTagColor }}
                            className="w-7 h-7 rounded-full shrink-0 hover:opacity-80 transition-opacity"
                          />
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-3">
                          <div className="flex gap-2 flex-wrap max-w-[200px]">
                            {TAG_COLORS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                onClick={() => setEditingTagColor(color)}
                                style={{ backgroundColor: color }}
                                className={`w-7 h-7 rounded-full transition-all ${
                                  editingTagColor === color ? 'ring-2 ring-offset-2 ring-offset-background ring-primary' : ''
                                }`}
                              />
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Input
                        value={editingTagName}
                        onChange={(e) => setEditingTagName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveTagEdit();
                          if (e.key === 'Escape') handleCancelTagEdit();
                        }}
                        className="flex-1"
                        autoFocus
                        aria-label="Redigera taggnamn"
                      />
                      <Button size="icon" variant="ghost" onClick={handleSaveTagEdit} aria-label="Spara tagg">
                        <Check className="w-4 h-4 text-[hsl(var(--success))]" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={handleCancelTagEdit} aria-label="Avbryt taggredigering">
                        <X className="w-4 h-4 text-muted-foreground" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <div
                        style={{ backgroundColor: tag.color }}
                        className="w-4 h-4 rounded-full shrink-0"
                        aria-hidden="true"
                      />
                      <span className="flex-1 font-medium">{tag.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {tag.color}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleStartEditTag(tag.id, tag.name, tag.color)}
                        aria-label={`Redigera taggen ${tag.name}`}
                      >
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteTagId(tag.id)}
                        aria-label={`Ta bort taggen ${tag.name}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
              {tags.length === 0 && (
                <div className="p-4 text-center text-muted-foreground">
                  Inga taggar ännu. Lägg till en ovan.
                </div>
              )}
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

      <AlertDialog open={!!deleteTagId} onOpenChange={() => setDeleteTagId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort tagg?</AlertDialogTitle>
            <AlertDialogDescription>
              Taggen tas bort från kunskapsbasens artiklar. Taggar som ingår i tidigare ärendehistorik kan inte tas bort.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Avbryt</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteTag} className={buttonVariants({ variant: 'destructive' })}>
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

  </>);
}
