import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, downloadBlob } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { useBackupFiles } from '@/hooks/useBackupFiles';

const formatSize = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function BackupFilesList() {
  const { files, isLoading, isError } = useBackupFiles();
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (name: string) => {
    setDownloading(name);
    try {
      downloadBlob(await api.downloadBackupFile(name), name);
    } catch {
      toast.error('Kunde inte ladda ned backupen. Försök igen.');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Sparade backuper</h3>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Laddar sparade backuper...
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Kunde inte ladda listan över sparade backuper.</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">Inga sparade backuper ännu.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {files.map((file) => (
            <li key={file.name} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(file.modifiedAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {formatSize(file.sizeBytes)}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleDownload(file.name)}
                disabled={downloading === file.name}
                aria-label={`Ladda ned ${file.name}`}
              >
                {downloading === file.name ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
