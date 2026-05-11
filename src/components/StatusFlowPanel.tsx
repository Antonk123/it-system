import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { StatusCounts } from '@/hooks/useStatusCounts';

interface StatusFlowPanelProps {
  counts: StatusCounts | undefined;
  isLoading: boolean;
}

const STATUS_CONFIG = [
  { key: 'open', label: 'Öppna', color: 'bg-[hsl(var(--status-open))]', dot: 'bg-[hsl(var(--status-open))]' },
  { key: 'in-progress', label: 'Pågående', color: 'bg-[hsl(var(--status-in-progress))]', dot: 'bg-[hsl(var(--status-in-progress))]' },
  { key: 'waiting', label: 'Väntar', color: 'bg-[hsl(var(--status-waiting))]', dot: 'bg-[hsl(var(--status-waiting))]' },
  { key: 'resolved', label: 'Lösta', color: 'bg-[hsl(var(--status-resolved))]', dot: 'bg-[hsl(var(--status-resolved))]' },
  { key: 'closed', label: 'Stängda', color: 'bg-[hsl(var(--status-closed))]', dot: 'bg-[hsl(var(--status-closed))]' },
];

export const StatusFlowPanel = ({ counts, isLoading }: StatusFlowPanelProps) => {
  const maxCount = counts ? Math.max(...Object.values(counts), 1) : 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">Statusfördelning</p>
          <span className="font-mono text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
            totalt
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3.5">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full rounded" />
          ))
        ) : (
          STATUS_CONFIG.map(({ key, label, color, dot }) => {
            const count = counts?.[key] ?? 0;
            const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="flex items-center gap-2 w-24 shrink-0">
                  <span className={cn('w-2 h-2 rounded-sm', dot)} />
                  <span className="text-xs font-medium text-foreground/80">{label}</span>
                </div>
                <div className="flex-1 h-2 bg-muted/50 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-[width] duration-300 ease-out', color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="font-mono text-xs font-semibold w-8 text-right tabular-nums">
                  {count}
                </span>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
};
