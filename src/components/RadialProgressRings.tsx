import { useMemo, useState } from 'react';
import { AnimatedNumber } from './AnimatedNumber';
import { cn } from '@/lib/utils';

interface RingData {
  name: string;
  value: number;
  status: string;
}

interface RadialProgressRingsProps {
  data: RingData[];
  total: number;
  className?: string;
}

const STATUS_COLORS: Record<string, string> = {
  'open': 'hsl(var(--chart-1))',
  'in-progress': 'hsl(var(--chart-2))',
  'waiting': 'hsl(var(--chart-3))',
  'resolved': 'hsl(var(--chart-4))',
  'closed': 'hsl(var(--muted-foreground))',
};

const STATUS_LABELS: Record<string, string> = {
  'open': 'Öppen',
  'in-progress': 'Pågående',
  'waiting': 'Väntar',
  'resolved': 'Löst',
  'closed': 'Stängd',
};

export const RadialProgressRings = ({ data, total, className }: RadialProgressRingsProps) => {
  const [hoveredRing, setHoveredRing] = useState<string | null>(null);

  // Process and sort data (ensure consistent ordering)
  const processedData = useMemo(() => {
    const statusOrder = ['open', 'in-progress', 'waiting', 'resolved', 'closed'];

    return statusOrder.map(status => {
      const item = data.find(d => d.status === status);
      const value = item?.value || 0;
      const percentage = total > 0 ? (value / total) * 100 : 0;

      return {
        status,
        label: STATUS_LABELS[status] || status,
        value,
        percentage,
        color: STATUS_COLORS[status] || 'hsl(var(--muted))',
      };
    });
  }, [data, total]);

  // SVG configuration
  const centerX = 100;
  const centerY = 100;
  const baseRadius = 75; // Outer ring radius
  const ringSpacing = 12; // Space between rings
  const strokeWidth = 8;

  // Calculate rings from outside to inside
  const rings = useMemo(() => {
    return processedData.map((item, index) => {
      const radius = baseRadius - (index * ringSpacing);
      const circumference = 2 * Math.PI * radius;
      const dashOffset = circumference - (circumference * item.percentage) / 100;

      return {
        ...item,
        radius,
        circumference,
        dashOffset,
        delay: index * 150, // Stagger animation
      };
    });
  }, [processedData, baseRadius]);

  return (
    <div className={cn('flex flex-col items-center gap-6', className)}>
      {/* SVG Ring Container */}
      <div
        className="relative w-full max-w-md aspect-square"
        role="img"
        aria-label={`Status distribution chart showing ${total} total tickets across ${processedData.filter(d => d.value > 0).length} statuses`}
      >
        <svg
          viewBox="0 0 200 200"
          className="w-full h-full"
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden="true"
        >
          {/* Background rings (full circles in muted color) */}
          {rings.map((ring, index) => (
            <circle
              key={`bg-${ring.status}`}
              cx={centerX}
              cy={centerY}
              r={ring.radius}
              fill="none"
              stroke="hsl(var(--muted))"
              strokeWidth={strokeWidth}
              opacity={0.15}
            />
          ))}

          {/* Progress rings */}
          {rings.map((ring, index) => (
            <circle
              key={`ring-${ring.status}`}
              cx={centerX}
              cy={centerY}
              r={ring.radius}
              fill="none"
              stroke={ring.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={ring.circumference}
              strokeDashoffset={ring.dashOffset}
              className={cn(
                'ring-segment transition-all duration-300',
                hoveredRing === ring.status && 'ring-segment-active'
              )}
              style={{
                transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)',
                transitionDelay: `${ring.delay}ms`,
                filter: hoveredRing === ring.status ? 'drop-shadow(0 0 8px currentColor)' : 'none',
              }}
              onMouseEnter={() => setHoveredRing(ring.status)}
              onMouseLeave={() => setHoveredRing(null)}
            />
          ))}

        </svg>

        {/* Center label overlay (outside SVG for better rendering) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              <AnimatedNumber value={total} duration={1200} />
            </div>
            <div className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
              Ärenden
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div
        className="grid grid-cols-2 gap-x-6 gap-y-2 w-full max-w-md"
        role="list"
        aria-label="Status breakdown legend"
      >
        {processedData.map((item) => (
          <button
            key={item.status}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200',
              'ring-legend-item hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary',
              hoveredRing === item.status && 'bg-muted'
            )}
            onMouseEnter={() => setHoveredRing(item.status)}
            onMouseLeave={() => setHoveredRing(null)}
            onClick={() => {
              // TODO: Add filtering functionality
              console.log('Filter by status:', item.status);
            }}
            role="listitem"
            aria-label={`${item.label}: ${item.value} tickets, ${item.percentage.toFixed(0)} percent`}
          >
            <div
              className="w-3 h-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-sm font-medium flex-1 text-left">
              {item.label}
            </span>
            <span className="text-sm text-muted-foreground">
              {item.value}
            </span>
            <span className="text-xs text-muted-foreground">
              ({item.percentage.toFixed(0)}%)
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
