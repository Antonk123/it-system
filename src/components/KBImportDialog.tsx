import { useState, useRef, useCallback, useEffect } from 'react';
import { Upload, FileText, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { useKbCategories } from '@/hooks/useKbCategories';
import { migrateContent } from '@/lib/contentMigration';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface KBImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategoryId?: string;
  onImported?: () => void;
}

type FileStatus = 'pending' | 'uploading' | 'done' | 'error';

interface QueuedFile {
  id: string;
  fileName: string;
  title: string;
  rawContent: string;
  parsedType: string | null;
  parsedTags: string[];
  status: FileStatus;
  errorMessage?: string;
}

const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt'];
const MAX_FILES = 50;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

interface Frontmatter {
  title?: string;
  tags?: string[];
  type?: string;
}

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: raw };

  const yamlBlock = match[1];
  const body = match[2];
  const fm: Frontmatter = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (!value) continue;
    if (key === 'title') fm.title = value;
    else if (key === 'tags' || key === 'tag') {
      // Accept "a, b, c" or "[a, b, c]"
      const cleaned = value.replace(/^\[|\]$/g, '');
      fm.tags = cleaned.split(',').map(t => t.trim().replace(/^["'](.*)["']$/, '$1')).filter(Boolean);
    } else if (key === 'type') {
      fm.type = value.toLowerCase();
    }
  }

  return { frontmatter: fm, body };
}

function titleFromFilename(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '');
  return base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Kunde inte läsa fil'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
}

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some(ext => name.endsWith(ext));
}

export function KBImportDialog({ open, onOpenChange, defaultCategoryId, onImported }: KBImportDialogProps) {
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const { categories } = useKbCategories();
  const [categoryId, setCategoryId] = useState<string>(defaultCategoryId || '');
  const [status, setStatus] = useState<'draft' | 'published'>('published');
  const [isImporting, setIsImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (defaultCategoryId) setCategoryId(defaultCategoryId);
  }, [defaultCategoryId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setFiles([]);
      setIsImporting(false);
      setIsDragOver(false);
    }
  }, [open]);

  const addFiles = useCallback(async (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const accepted: File[] = [];
    let rejectedCount = 0;
    let tooLargeCount = 0;

    for (const f of list) {
      if (!isAcceptedFile(f)) { rejectedCount++; continue; }
      if (f.size > MAX_FILE_SIZE_BYTES) { tooLargeCount++; continue; }
      accepted.push(f);
    }

    if (rejectedCount > 0) {
      toast.error(`${rejectedCount} fil(er) hoppades över (endast .md, .markdown, .txt stöds)`);
    }
    if (tooLargeCount > 0) {
      toast.error(`${tooLargeCount} fil(er) är för stora (max 2 MB)`);
    }

    const queued: QueuedFile[] = [];
    for (const f of accepted) {
      try {
        const raw = await readFileAsText(f);
        const { frontmatter, body } = parseFrontmatter(raw);
        queued.push({
          id: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: f.name,
          title: frontmatter.title || titleFromFilename(f.name) || f.name,
          rawContent: body,
          parsedType: frontmatter.type === 'how-to' || frontmatter.type === 'solution' ? frontmatter.type : null,
          parsedTags: frontmatter.tags || [],
          status: 'pending',
        });
      } catch {
        queued.push({
          id: `${f.name}-err-${Date.now()}`,
          fileName: f.name,
          title: titleFromFilename(f.name) || f.name,
          rawContent: '',
          parsedType: null,
          parsedTags: [],
          status: 'error',
          errorMessage: 'Kunde inte läsa fil',
        });
      }
    }

    setFiles(prev => {
      const merged = [...prev, ...queued];
      if (merged.length > MAX_FILES) {
        toast.error(`Max ${MAX_FILES} filer åt gången`);
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
  }, []);

  const onPickFiles = () => inputRef.current?.click();

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  };

  const updateTitle = (id: string, title: string) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, title } : f));
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const validFiles = files.filter(f => f.status !== 'error' || f.rawContent);
  const canImport = !isImporting && categoryId && validFiles.length > 0 && validFiles.every(f => f.title.trim());

  const handleImport = async () => {
    if (!canImport) return;
    setIsImporting(true);

    let okCount = 0;
    let failCount = 0;

    for (const file of files) {
      if (file.status === 'done' || file.status === 'error') continue;
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'uploading' } : f));

      try {
        const html = migrateContent(file.rawContent);
        await api.createKbArticle({
          title: file.title.trim(),
          content: html,
          category_id: categoryId,
          article_type: file.parsedType,
          tag_ids: [],
          status,
        });
        setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'done' } : f));
        okCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Okänt fel';
        setFiles(prev => prev.map(f => f.id === file.id ? { ...f, status: 'error', errorMessage: msg } : f));
        failCount++;
      }
    }

    setIsImporting(false);
    if (okCount > 0) {
      toast.success(`Importerade ${okCount} artikel${okCount === 1 ? '' : 'ar'}`);
      onImported?.();
    }
    if (failCount > 0) {
      toast.error(`${failCount} fil(er) misslyckades`);
    }
  };

  const pendingCount = files.filter(f => f.status === 'pending').length;
  const doneCount = files.filter(f => f.status === 'done').length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Importera artiklar</DialogTitle>
          <DialogDescription>
            Ladda upp .md, .markdown eller .txt-filer. Filnamn blir titel (kan redigeras). YAML-frontmatter (title, tags, type) tolkas om den finns.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
            className={cn(
              'border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer',
              isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-muted-foreground/50',
            )}
            onClick={onPickFiles}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickFiles(); } }}
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Dra hit filer eller klicka för att välja</p>
            <p className="text-xs text-muted-foreground mt-1">
              .md, .markdown, .txt &middot; max 2 MB per fil &middot; max {MAX_FILES} filer
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              onChange={onInputChange}
              className="hidden"
            />
          </div>

          {/* Settings */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="import-category">Kategori *</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="import-category">
                  <SelectValue placeholder="Välj kategori" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="import-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as 'draft' | 'published')}>
                <SelectTrigger id="import-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Publicerad</SelectItem>
                  <SelectItem value="draft">Utkast</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* File list */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">
                  {files.length} fil{files.length === 1 ? '' : 'er'}
                  {doneCount > 0 && <span className="text-muted-foreground"> &middot; {doneCount} klara</span>}
                </Label>
                {!isImporting && pendingCount > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles(prev => prev.filter(f => f.status === 'done'))}
                  >
                    Rensa ej importerade
                  </Button>
                )}
              </div>
              <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
                {files.map(f => (
                  <div key={f.id} className="flex items-center gap-2 p-2">
                    <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <Input
                        value={f.title}
                        onChange={(e) => updateTitle(f.id, e.target.value)}
                        disabled={f.status === 'uploading' || f.status === 'done'}
                        className="h-8 text-sm"
                        aria-label={`Titel för ${f.fileName}`}
                      />
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground truncate">
                        <span className="truncate">{f.fileName}</span>
                        {f.parsedType && <span className="text-primary">&middot; {f.parsedType}</span>}
                        {f.errorMessage && <span className="text-destructive">&middot; {f.errorMessage}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 w-6 flex justify-center">
                      {f.status === 'uploading' && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                      {f.status === 'done' && <CheckCircle2 className="w-4 h-4 text-[hsl(var(--success))]" />}
                      {f.status === 'error' && <AlertCircle className="w-4 h-4 text-destructive" />}
                      {f.status === 'pending' && !isImporting && (
                        <button
                          type="button"
                          onClick={() => removeFile(f.id)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Ta bort ${f.fileName}`}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting}>
            {doneCount > 0 ? 'Stäng' : 'Avbryt'}
          </Button>
          <Button onClick={handleImport} disabled={!canImport}>
            {isImporting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Importera {pendingCount > 0 ? `${pendingCount} fil${pendingCount === 1 ? '' : 'er'}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
