import { useState } from 'react';
import { Clock, X, Plus } from 'lucide-react';
import { useTimeEntries } from '@/hooks/useTimeEntries';
import { parseDuration, formatDuration } from '@/lib/duration';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TimeSectionProps {
  ticketId: string;
}

const TimeSection = ({ ticketId }: TimeSectionProps) => {
  const { entries, totalMinutes, isLoading, addEntry, deleteEntry, isAdding } = useTimeEntries(ticketId);

  const [durationInput, setDurationInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const parsed = parseDuration(durationInput);
    if (parsed === null || parsed <= 0) {
      setError('Ange en giltig tid (t.ex. 30m eller 1h 30m)');
      return;
    }
    setError(null);
    addEntry({ duration_minutes: parsed, note: noteInput.trim() || undefined });
    setDurationInput('');
    setNoteInput('');
  };

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-muted-foreground" />
          <span className="font-medium text-sm">Tid</span>
        </div>
        {totalMinutes > 0 && (
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {formatDuration(totalMinutes)}
          </span>
        )}
      </div>

      {/* Entry list */}
      {entries.length > 0 && (
        <div className="space-y-2 mt-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-start justify-between text-sm py-1"
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium">{formatDuration(entry.duration_minutes)}</span>
                <span className="text-muted-foreground ml-2">
                  {format(new Date(entry.created_at), 'd MMM yyyy', { locale: sv })}
                </span>
                {entry.note && (
                  <p className="text-muted-foreground text-xs mt-0.5 truncate">{entry.note}</p>
                )}
              </div>
              <button
                onClick={() => deleteEntry(entry.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive ml-2 mt-0.5"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground mt-3">Ingen tid loggad</p>
      )}

      {/* Separator */}
      <div className="border-t border-dashed my-3" />

      {/* Input area */}
      <div className="space-y-2">
        <Input
          placeholder="1h 30m, 90m, 45..."
          value={durationInput}
          onChange={(e) => {
            setDurationInput(e.target.value);
            setError(null);
          }}
          className="h-8 text-sm"
        />
        <Input
          placeholder="Anteckning (valfri)..."
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          className="h-8 text-sm"
        />
        {error !== null && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <Button
          size="sm"
          className="w-full h-8"
          onClick={handleSubmit}
          disabled={isAdding || !durationInput.trim()}
        >
          <Plus size={14} className="mr-1" />
          Logga tid
        </Button>
      </div>
    </div>
  );
};

export default TimeSection;
