import { useState } from 'react';
import { Upload, X, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface PreviewResult {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  results: Array<{
    valid: boolean;
    errors: string[];
    ticket: any;
    isDuplicate: boolean;
  }>;
}

export const ImportDialog = ({ open, onOpenChange, onSuccess }: ImportDialogProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = e.dataTransfer.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      handleFile(files[0]);
    }
  };

  const handleFile = async (selectedFile: File) => {
    if (!selectedFile.name.endsWith('.csv')) {
      toast.error('Endast CSV-filer är tillåtna');
      return;
    }

    setFile(selectedFile);
    setPreview(null);
    setIsLoading(true);

    try {
      const result = await api.importTicketsPreview(selectedFile);
      setPreview(result);

      if (result.invalid > 0) {
        toast.warning(`${result.invalid} ärenden har valideringsfel`);
      } else {
        toast.success(`${result.valid} ärenden redo att importeras`);
      }
    } catch (error) {
      console.error('Preview failed:', error);
      toast.error('Misslyckades att förhandsgranska CSV-filen');
      setFile(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!preview) return;

    const validTickets = preview.results
      .filter(r => r.valid && !r.isDuplicate)
      .map(r => r.ticket);

    if (validTickets.length === 0) {
      toast.error('Inga giltiga ärenden att importera');
      return;
    }

    setImporting(true);

    try {
      const result = await api.importTicketsConfirm(validTickets);

      if (result.success) {
        toast.success(`${result.created} ärenden importerade!`);
        onSuccess();
        handleClose();
      } else {
        toast.error('Import misslyckades');
      }
    } catch (error) {
      console.error('Import failed:', error);
      toast.error('Misslyckades att importera ärenden');
    } finally {
      setImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setPreview(null);
    setIsLoading(false);
    setImporting(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importera ärenden från CSV</DialogTitle>
          <DialogDescription>
            Ladda upp en CSV-fil för att importera flera ärenden samtidigt.
          </DialogDescription>
        </DialogHeader>

        {!file && (
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium mb-2">
              Dra och släpp CSV-fil här
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              eller klicka för att välja fil
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileInput}
              className="hidden"
              id="csv-file-input"
            />
            <label htmlFor="csv-file-input">
              <Button variant="outline" asChild>
                <span>Välj fil</span>
              </Button>
            </label>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-4 text-sm text-muted-foreground">
              Förhandsgranskar CSV-fil...
            </p>
          </div>
        )}

        {preview && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Förhandsgranskning</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFile(null);
                  setPreview(null);
                }}
              >
                <X className="w-4 h-4 mr-2" />
                Avbryt
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div className="border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Totalt</span>
                </div>
                <p className="text-2xl font-bold">{preview.total}</p>
              </div>

              <div className="border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">Giltiga</span>
                </div>
                <p className="text-2xl font-bold text-green-600">{preview.valid}</p>
              </div>

              <div className="border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-muted-foreground">Ogiltiga</span>
                </div>
                <p className="text-2xl font-bold text-red-600">{preview.invalid}</p>
              </div>

              <div className="border rounded-lg p-4 bg-card">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4 text-yellow-500" />
                  <span className="text-sm text-muted-foreground">Dubletter</span>
                </div>
                <p className="text-2xl font-bold text-yellow-600">{preview.duplicates}</p>
              </div>
            </div>

            {preview.results.filter(r => !r.valid).length > 0 && (
              <div className="border rounded-lg p-4 bg-red-50 dark:bg-red-950/20">
                <h4 className="font-semibold mb-2 text-red-900 dark:text-red-100">
                  Valideringsfel ({preview.results.filter(r => !r.valid).length} st)
                </h4>
                <div className="space-y-3 max-h-60 overflow-y-auto">
                  {preview.results
                    .filter(r => !r.valid)
                    .slice(0, 10)
                    .map((result, idx) => (
                      <div key={idx} className="text-sm border-b border-red-200 dark:border-red-800 pb-2 last:border-0">
                        <p className="font-medium text-red-800 dark:text-red-200">
                          {result.ticket.title || '(Ingen titel)'}
                        </p>
                        <div className="text-xs text-red-600 dark:text-red-400 mt-1 space-y-1">
                          {result.ticket.category && (
                            <p>Kategori: {result.ticket.category}</p>
                          )}
                          {result.ticket.requester_name && (
                            <p>Beställare: {result.ticket.requester_name}</p>
                          )}
                        </div>
                        <ul className="list-disc list-inside text-red-700 dark:text-red-300 mt-1">
                          {result.errors.map((error, i) => (
                            <li key={i}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
                {preview.results.filter(r => !r.valid).length > 10 && (
                  <p className="text-sm text-red-700 dark:text-red-300 mt-2">
                    ... och {preview.results.filter(r => !r.valid).length - 10} till
                  </p>
                )}
              </div>
            )}

            {/* Debug info for valid tickets */}
            {preview.results.filter(r => r.valid).length > 0 && (
              <div className="border rounded-lg p-4 bg-green-50 dark:bg-green-950/20">
                <h4 className="font-semibold mb-2 text-green-900 dark:text-green-100">
                  Giltiga ärenden ({preview.results.filter(r => r.valid).length} st)
                </h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {preview.results
                    .filter(r => r.valid)
                    .slice(0, 5)
                    .map((result, idx) => (
                      <div key={idx} className="text-sm">
                        <p className="font-medium text-green-800 dark:text-green-200">
                          {result.ticket.title}
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Kategori: {result.ticket.category || '(ingen)'} |
                          Beställare: {result.ticket.requester_name || '(ingen)'}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>
                Avbryt
              </Button>
              <Button
                onClick={handleConfirmImport}
                disabled={preview.valid === 0 || importing}
              >
                {importing ? 'Importerar...' : `Importera ${preview.valid - preview.duplicates} ärenden`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
