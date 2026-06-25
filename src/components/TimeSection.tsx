import { useState } from 'react';
import { Clock, X, Plus, Pencil } from 'lucide-react';
import { useTimeEntries } from '@/hooks/useTimeEntries';
import { parseDuration, formatDuration } from '@/lib/duration';
import { parseServerDate } from '@/lib/date';
import { format, parseISO } from 'date-fns';
import { sv } from 'date-fns/locale';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TimeEntryRow } from '@/types/ticket';

interface TimeSectionProps {
  ticketId: string;
}

// Render an entry's date — prefer the (optional) work date, fall back to log time.
function entryDateLabel(entry: TimeEntryRow): string {
  if (entry.work_date) {
    return format(parseISO(entry.work_date), 'd MMM yyyy', { locale: sv });
  }
  return format(parseServerDate(entry.created_at), 'd MMM yyyy', { locale: sv });
}

const TimeSection = ({ ticketId }: TimeSectionProps) => {
  const { entries, totalMinutes, isLoading, addEntry, editTimeEntry, deleteEntry, isAdding, isEditing } =
    useTimeEntries(ticketId);

  const [durationInput, setDurationInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [billable, setBillable] = useState(true);
  const [workDate, setWorkDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Edit dialog state
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [editDuration, setEditDuration] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editBillable, setEditBillable] = useState(true);
  const [editWorkDate, setEditWorkDate] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const handleSubmit = () => {
    const parsed = parseDuration(durationInput);
    if (parsed === null || parsed <= 0) {
      setError('Ange en giltig tid (t.ex. 30m eller 1h 30m)');
      return;
    }
    setError(null);
    addEntry({
      duration_minutes: parsed,
      note: noteInput.trim() || undefined,
      billable,
      work_date: workDate || null,
    });
    setDurationInput('');
    setNoteInput('');
    setBillable(true);
    setWorkDate('');
  };

  const openEdit = (entry: TimeEntryRow) => {
    setEditingEntry(entry);
    setEditDuration(formatDuration(entry.duration_minutes));
    setEditNote(entry.note ?? '');
    setEditBillable(entry.billable !== 0);
    setEditWorkDate(entry.work_date ?? '');
    setEditError(null);
  };

  const handleEditSubmit = async () => {
    if (!editingEntry) return;
    const parsed = parseDuration(editDuration);
    if (parsed === null || parsed <= 0) {
      setEditError('Ange en giltig tid (t.ex. 30m eller 1h 30m)');
      return;
    }
    setEditError(null);
    try {
      await editTimeEntry({
        id: editingEntry.id,
        payload: {
          duration_minutes: parsed,
          note: editNote.trim() || null,
          billable: editBillable,
          work_date: editWorkDate || null,
        },
      });
      setEditingEntry(null);
    } catch {
      // Felmeddelande visas redan via toast i hooken; håll dialogen öppen.
    }
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
          {entries.map((entry) => {
            const invoiced = !!entry.invoice_id;
            return (
              <div
                key={entry.id}
                className="group flex items-start justify-between text-sm py-1"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{formatDuration(entry.duration_minutes)}</span>
                    <span className="text-muted-foreground">{entryDateLabel(entry)}</span>
                    {entry.billable === 0 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                        Ej fakturerbar
                      </Badge>
                    )}
                    {invoiced && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                        Fakturerad
                      </Badge>
                    )}
                  </div>
                  {entry.note && (
                    <p className="text-muted-foreground text-xs mt-0.5 truncate">{entry.note}</p>
                  )}
                </div>
                <div className="flex items-center shrink-0 ml-2">
                  {!invoiced && (
                    <button
                      onClick={() => openEdit(entry)}
                      className="md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-9 w-9 md:h-7 md:w-7 rounded"
                      aria-label="Redigera tidpost"
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    className="md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive inline-flex items-center justify-center h-9 w-9 md:h-7 md:w-7 rounded"
                    aria-label="Ta bort tidpost"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            );
          })}
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
          aria-label="Tid att logga"
        />
        <Input
          placeholder="Anteckning (valfri)..."
          value={noteInput}
          onChange={(e) => setNoteInput(e.target.value)}
          className="h-8 text-sm"
          aria-label="Anteckning"
        />
        <div className="space-y-1">
          <Label htmlFor="time-work-date" className="text-xs text-muted-foreground">
            Arbetsdatum (valfritt)
          </Label>
          <Input
            id="time-work-date"
            type="date"
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            className="h-8 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="time-billable"
            checked={billable}
            onCheckedChange={(checked) => setBillable(checked === true)}
          />
          <Label htmlFor="time-billable" className="text-sm font-normal cursor-pointer">
            Fakturerbar
          </Label>
        </div>
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

      {/* Edit dialog */}
      <Dialog open={!!editingEntry} onOpenChange={(open) => !open && setEditingEntry(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Redigera tidpost</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="edit-time-duration" className="text-xs text-muted-foreground">
                Tid
              </Label>
              <Input
                id="edit-time-duration"
                placeholder="1h 30m, 90m, 45..."
                value={editDuration}
                onChange={(e) => {
                  setEditDuration(e.target.value);
                  setEditError(null);
                }}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-time-note" className="text-xs text-muted-foreground">
                Anteckning (valfri)
              </Label>
              <Input
                id="edit-time-note"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-time-work-date" className="text-xs text-muted-foreground">
                Arbetsdatum (valfritt)
              </Label>
              <Input
                id="edit-time-work-date"
                type="date"
                value={editWorkDate}
                onChange={(e) => setEditWorkDate(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-time-billable"
                checked={editBillable}
                onCheckedChange={(checked) => setEditBillable(checked === true)}
              />
              <Label htmlFor="edit-time-billable" className="text-sm font-normal cursor-pointer">
                Fakturerbar
              </Label>
            </div>
            {editError !== null && (
              <p className="text-xs text-destructive">{editError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditingEntry(null)}>
              Avbryt
            </Button>
            <Button size="sm" onClick={handleEditSubmit} disabled={isEditing || !editDuration.trim()}>
              Spara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TimeSection;
