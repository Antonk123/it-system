import { useEffect, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, CalendarClock, Play } from 'lucide-react';
import { formatDate } from '@/lib/date';
import { useBackupConfig, useRunBackupNow } from '@/hooks/useBackupConfig';

const formatBytes = (bytes: number | null): string => {
  if (bytes == null) return '';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function BackupScheduleSection() {
  const { config, isLoading, isError, updateConfig } = useBackupConfig();
  const runNow = useRunBackupNow();

  const [enabled, setEnabled] = useState(false);
  const [time, setTime] = useState('02:00');
  const [retentionDays, setRetentionDays] = useState(7);

  // Synka lokalt formulärtillstånd med serverkonfigurationen när den laddats.
  useEffect(() => {
    if (config) {
      setEnabled(config.enabled);
      setTime(config.time);
      setRetentionDays(config.retentionDays);
    }
  }, [config]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Laddar backup-schema...
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Kunde inte ladda backup-schemat.
      </p>
    );
  }

  const handleSave = () => {
    updateConfig.mutate({ enabled, time, retentionDays });
  };

  const lastRun = config?.lastRunAt;
  const statusIcon = config?.lastStatus === 'success' ? '✓' : config?.lastStatus === 'failed' ? '✗' : '';
  const sizeLabel = formatBytes(config?.lastSizeBytes ?? null);

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <CalendarClock className="w-5 h-5 text-muted-foreground" />
        <div className="flex-1">
          <Label htmlFor="backup-enabled" className="text-base font-medium">
            Automatisk backup
          </Label>
          <p className="text-sm text-muted-foreground">
            Kör en schemalagd backup dagligen och behåll de senaste kopiorna.
          </p>
        </div>
        <Switch
          id="backup-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
        />
      </div>

      {enabled && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="backup-time">Tid (HH:MM)</Label>
            <Input
              id="backup-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="backup-retention">Lagringstid (dagar)</Label>
            <Input
              id="backup-retention"
              type="number"
              min={1}
              value={retentionDays}
              onChange={(e) => setRetentionDays(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {lastRun
          ? `Senaste: ${formatDate(lastRun, { year: 'numeric', month: 'short', day: 'numeric' })}${statusIcon ? ` ${statusIcon}` : ''}${sizeLabel ? ` (${sizeLabel})` : ''}`
          : 'Ingen körning än'}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={updateConfig.isPending}>
          {updateConfig.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Spara
        </Button>
        <Button
          variant="outline"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
        >
          {runNow.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Play className="w-4 h-4 mr-2" />
          )}
          {runNow.isPending ? 'Kör backup...' : 'Kör backup nu'}
        </Button>
      </div>
    </div>
  );
}
