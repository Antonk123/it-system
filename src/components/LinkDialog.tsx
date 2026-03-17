import { useState, useEffect } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface LinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (url: string, text?: string) => void;
  initialUrl?: string;
  initialText?: string;
}

export const LinkDialog = ({
  open,
  onOpenChange,
  onSubmit,
  initialUrl = '',
  initialText = '',
}: LinkDialogProps) => {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState(initialText);

  // Reset form when popover opens
  useEffect(() => {
    if (open) {
      setUrl(initialUrl);
      setText(initialText);
    }
  }, [open, initialUrl, initialText]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    onSubmit(url.trim(), text.trim() || undefined);
    onOpenChange(false);

    // Reset form
    setUrl('');
    setText('');
  };

  const handleCancel = () => {
    onOpenChange(false);
    setUrl('');
    setText('');
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b pb-2">
            <LinkIcon className="h-4 w-4" />
            <h4 className="font-semibold text-sm">Infoga länk</h4>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="url" className="text-xs">URL *</Label>
              <Input
                id="url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                required
                autoFocus
                className="h-8 text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="text" className="text-xs">Visningstext (valfritt)</Label>
              <Input
                id="text"
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Klicka här"
                className="h-8 text-sm"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancel}
              >
                Avbryt
              </Button>
              <Button type="submit" size="sm" disabled={!url.trim()}>
                Infoga
              </Button>
            </div>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
};
