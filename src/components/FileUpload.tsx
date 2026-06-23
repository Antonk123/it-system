import { useRef, useState } from 'react';
import { Upload, X, FileText, Image, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TicketAttachment } from '@/hooks/useTicketAttachments';
import { cn } from '@/lib/utils';
import { SecureImage, SecureDownloadLink } from '@/components/SecureAttachment';
import { toast } from 'sonner';

// Matches the backend multer limit (server/src/routes/tickets.ts).
// Bumping this means bumping it on the server too.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

interface FileUploadProps {
  attachments: TicketAttachment[];
  pendingFiles: File[];
  onFilesSelect: (files: File[]) => void;
  onRemovePending: (index: number) => void;
  onRemoveAttachment: (attachment: TicketAttachment) => void;
  isUploading?: boolean;
  disabled?: boolean;
}

const formatFileSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (type: string | null) => {
  if (!type) return File;
  if (type.startsWith('image/')) return Image;
  return FileText;
};

export const FileUpload = ({
  attachments,
  pendingFiles,
  onFilesSelect,
  onRemovePending,
  onRemoveAttachment,
  isUploading,
  disabled,
}: FileUploadProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Filter out oversized files and toast per rejection. Returns the surviving
  // set so callers can decide whether to forward anything.
  const filterBySize = (files: File[]): File[] => {
    const accepted: File[] = [];
    for (const f of files) {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`${f.name} är större än 10 MB och hoppades över`);
        continue;
      }
      accepted.push(f);
    }
    return accepted;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) {
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const files = filterBySize(Array.from(e.target.files || []));
    if (files.length > 0) {
      onFilesSelect(files);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    // Disabled was decorative — the dashed area still accepted drops. Hard-stop
    // here so the user gets the same behaviour they see from the button.
    if (disabled) return;
    const files = filterBySize(Array.from(e.dataTransfer.files));
    if (files.length > 0) {
      onFilesSelect(files);
    }
  };

  return (
    <div className="space-y-3">
      {/* Upload Area */}
      <div
        className={cn(
          "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
          isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
          disabled && "opacity-50 cursor-not-allowed"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={handleFileChange}
          className="hidden"
          disabled={disabled}
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.eml,.zip,.rar,.7z"
        />
        <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground mb-2">
          Dra och släpp filer här, eller
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isUploading}
        >
          {isUploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Laddar upp...
            </>
          ) : (
            'Bläddra filer'
          )}
        </Button>
        <p className="text-xs text-muted-foreground mt-2">
          Max 10MB per fil • Bilder, PDF, Dokument
        </p>
      </div>

      {/* Existing Attachments */}
      {attachments.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Bilagor</p>
          {attachments.map((attachment) => {
            const Icon = getFileIcon(attachment.fileType);
            return (
              <div
                key={attachment.id}
                className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg"
              >
                {attachment.fileType?.startsWith('image/') ? (
                  <SecureImage
                    fileId={attachment.id}
                    alt={attachment.fileName}
                    className="w-10 h-10 object-cover rounded"
                  />
                ) : (
                  <div className="w-10 h-10 flex items-center justify-center bg-muted rounded">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <SecureDownloadLink
                    fileId={attachment.id}
                    filename={attachment.fileName}
                    className="text-sm font-medium truncate block hover:underline"
                  >
                    {attachment.fileName}
                  </SecureDownloadLink>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(attachment.fileSize)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => onRemoveAttachment(attachment)}
                  disabled={disabled}
                  aria-label="Ta bort bilaga"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending Files */}
      {pendingFiles.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Filer att ladda upp</p>
          {pendingFiles.map((file, index) => {
            const Icon = getFileIcon(file.type);
            return (
              <div
                key={index}
                className="flex items-center gap-3 p-2 bg-primary/5 border border-primary/20 rounded-lg"
              >
                <div className="w-10 h-10 flex items-center justify-center bg-primary/10 rounded">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onRemovePending(index)}
                  disabled={disabled}
                  aria-label="Ta bort bilaga"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
