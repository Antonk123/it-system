import { useRef, useState } from 'react';
import { Upload, X, FileText, Image, File, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TicketAttachment } from '@/hooks/useTicketAttachments';
import { cn } from '@/lib/utils';
import { SecureImage, SecureDownloadLink } from '@/components/SecureAttachment';

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelect(files);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
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
          accept="image/*,.pdf,.doc,.docx,.txt,.xlsx,.xls,.csv"
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
