import { useState } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

interface MarkdownTextareaProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  maxLength?: number;
  className?: string;
}

export const MarkdownTextarea = ({ value, onChange, ...textareaProps }: MarkdownTextareaProps) => {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  return (
    <div>
      <div className="flex gap-1 mb-1">
        <button
          type="button"
          onClick={() => setMode('edit')}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            mode === 'edit'
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Redigera
        </button>
        <button
          type="button"
          onClick={() => setMode('preview')}
          className={`text-xs px-2 py-1 rounded transition-colors ${
            mode === 'preview'
              ? 'bg-muted font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Förhandsgranska
        </button>
      </div>

      {mode === 'edit' ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...textareaProps}
        />
      ) : (
        <div className="min-h-[6rem] rounded-md border bg-muted/30 px-3 py-2">
          {value ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="text-sm text-muted-foreground italic">Inget innehåll att förhandsgranska.</p>
          )}
        </div>
      )}
    </div>
  );
};
