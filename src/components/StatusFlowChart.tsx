import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, parse } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { useStatusFlow } from '@/hooks/useStatusFlow';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface StatusFlowChartProps {
  className?: string;
  height?: number;
  timePeriod?: 'monthly';
}

interface MonthStatusData {
  month: string;
  open: number;
  'in-progress': number;
  waiting: number;
  resolved: number;
  closed: number;
}

const StatusFlowTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;

  const total = payload.reduce((sum: number, entry: any) => sum + entry.value, 0);

  return (
    <div className="bg-popover text-popover-foreground px-4 py-3 rounded-lg shadow-lg border">
      <p className="font-semibold mb-2">{label}</p>
      <div className="space-y-1 text-sm">
        {[...payload].reverse().map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: entry.color }}
              />
              <span className="capitalize">
                {entry.dataKey === 'in-progress' ? 'In Progress' : entry.dataKey}
              </span>
            </div>
            <span className="font-mono font-semibold">{entry.value}</span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 pt-2 mt-2 border-t">
          <span className="font-semibold">Total</span>
          <span className="font-mono font-semibold">{total}</span>
        </div>
      </div>
    </div>
  );
};

export const StatusFlowChart = ({
  className,
  height = 300,
}: StatusFlowChartProps) => {
  // Server-side aggregation over the full dataset (no 1000-row cap). Returns one
  // row per YYYY-MM for the trailing 12 months; we map the key to the same short
  // month label the chart used before (date-fns 'MMM') so it renders identically.
  const { data: statusFlow, isLoading, isError } = useStatusFlow();

  const monthStatusData = useMemo<MonthStatusData[]>(() => {
    if (!statusFlow) return [];
    return statusFlow.map(row => ({
      month: format(parse(row.month, 'yyyy-MM', new Date()), 'MMM'),
      open: row.open,
      'in-progress': row['in-progress'],
      waiting: row.waiting,
      resolved: row.resolved,
      closed: row.closed,
    }));
  }, [statusFlow]);

  if (isLoading) {
    return <Skeleton className="w-full" style={{ height }} />;
  }

  if (isError) {
    return (
      <div
        className={cn('w-full flex flex-col items-center justify-center gap-3 text-muted-foreground', className)}
        style={{ height }}
      >
        <AlertTriangle className="w-8 h-8 text-destructive/70" />
        <span>Kunde inte ladda data</span>
      </div>
    );
  }

  const gradients = {
    open: 'gradient-status-open',
    inProgress: 'gradient-status-inprogress',
    waiting: 'gradient-status-waiting',
    resolved: 'gradient-status-resolved',
    closed: 'gradient-status-closed',
  };

  // Status colors from Reports.tsx
  const statusColors = {
    open: 'hsl(var(--chart-1))',
    'in-progress': 'hsl(var(--chart-2))',
    waiting: 'hsl(var(--chart-5))',
    resolved: 'hsl(var(--chart-3))',
    closed: 'hsl(var(--chart-4))',
  };

  return (
    <div className={cn('w-full', className)}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={monthStatusData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            {/* Open gradient */}
            <linearGradient id={gradients.open} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={statusColors.open} stopOpacity={0.4} />
              <stop offset="95%" stopColor={statusColors.open} stopOpacity={0.1} />
            </linearGradient>

            {/* In-Progress gradient */}
            <linearGradient id={gradients.inProgress} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={statusColors['in-progress']} stopOpacity={0.4} />
              <stop offset="95%" stopColor={statusColors['in-progress']} stopOpacity={0.1} />
            </linearGradient>

            {/* Waiting gradient */}
            <linearGradient id={gradients.waiting} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={statusColors.waiting} stopOpacity={0.4} />
              <stop offset="95%" stopColor={statusColors.waiting} stopOpacity={0.1} />
            </linearGradient>

            {/* Resolved gradient */}
            <linearGradient id={gradients.resolved} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={statusColors.resolved} stopOpacity={0.4} />
              <stop offset="95%" stopColor={statusColors.resolved} stopOpacity={0.1} />
            </linearGradient>

            {/* Closed gradient */}
            <linearGradient id={gradients.closed} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={statusColors.closed} stopOpacity={0.4} />
              <stop offset="95%" stopColor={statusColors.closed} stopOpacity={0.1} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" opacity={0.3} />

          <XAxis
            dataKey="month"
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          />

          <YAxis
            className="text-xs"
            tick={{ fill: 'hsl(var(--muted-foreground))' }}
            tickLine={{ stroke: 'hsl(var(--muted-foreground))' }}
          />

          <Tooltip content={<StatusFlowTooltip />} />

          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="square"
            formatter={(value) => {
              if (value === 'in-progress') return 'In Progress';
              return value.charAt(0).toUpperCase() + value.slice(1);
            }}
          />

          <Area
            type="monotone"
            dataKey="closed"
            stackId="1"
            stroke={statusColors.closed}
            strokeWidth={2}
            fill={`url(#${gradients.closed})`}
            animationDuration={1200}
            animationEasing="ease-out"
          />

          <Area
            type="monotone"
            dataKey="resolved"
            stackId="1"
            stroke={statusColors.resolved}
            strokeWidth={2}
            fill={`url(#${gradients.resolved})`}
            animationDuration={1200}
            animationEasing="ease-out"
          />

          <Area
            type="monotone"
            dataKey="waiting"
            stackId="1"
            stroke={statusColors.waiting}
            strokeWidth={2}
            fill={`url(#${gradients.waiting})`}
            animationDuration={1200}
            animationEasing="ease-out"
          />

          <Area
            type="monotone"
            dataKey="in-progress"
            stackId="1"
            stroke={statusColors['in-progress']}
            strokeWidth={2}
            fill={`url(#${gradients.inProgress})`}
            animationDuration={1200}
            animationEasing="ease-out"
          />

          <Area
            type="monotone"
            dataKey="open"
            stackId="1"
            stroke={statusColors.open}
            strokeWidth={2}
            fill={`url(#${gradients.open})`}
            animationDuration={1200}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};
