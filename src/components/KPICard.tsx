import { ReactNode, lazy, Suspense } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { cn } from '@/lib/utils';

// Lazy-load SparklineChart så att recharts bara laddas när sparklineData faktiskt finns
const SparklineChart = lazy(() =>
  import('@/components/SparklineChart').then((m) => ({ default: m.SparklineChart }))
);

interface KPICardProps {
  label: string;
  value: number;
  valueDecimals?: number;
  valueSuffix?: string;
  valuePrefix?: string;
  icon: ReactNode;
  sparklineData?: { month: string; value: number }[];
  trend?: {
    value: number;
    direction: 'up' | 'down';
    isPositive: boolean;
  };
  gradient?: string;
  className?: string;
  onClick?: () => void;
  subLabel?: string | ReactNode;
  /** ms-fördröjning för staggered entrance-reveal (sätts t.ex. av Reports KPI-raden) */
  animationDelay?: number;
}

export const KPICard = ({
  label,
  value,
  valueDecimals = 0,
  valueSuffix = '',
  valuePrefix = '',
  icon,
  sparklineData,
  trend,
  className,
  onClick,
  subLabel,
  animationDelay,
}: KPICardProps) => {
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : TrendingDown;
  const trendColor = trend
    ? trend.isPositive
      ? 'text-[hsl(var(--success))]'
      : 'text-[hsl(var(--destructive))]'
    : '';

  // Tangentbordshanterare för klickbara kort
  const handleKeyDown = onClick
    ? (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }
    : undefined;

  return (
    <Card
        className={cn(
          'relative overflow-hidden shadow-none transition-colors duration-150',
          'hover:border-primary/50',
          onClick && 'cursor-pointer',
          animationDelay != null && 'animate-fade-in',
          className
        )}
        style={
          animationDelay != null
            ? { animationDelay: `${animationDelay}ms`, animationFillMode: 'backwards' }
            : undefined
        }
        onClick={onClick}
        {...(onClick
          ? { role: 'button', tabIndex: 0, onKeyDown: handleKeyDown }
          : {})}
      >
        {/* Register marks — the plaque's own corner ticks, not a decorative blob */}
        <span aria-hidden className="absolute left-0 top-0 w-2.5 h-2.5 border-l border-t border-border" />
        <span aria-hidden className="absolute right-0 bottom-0 w-2.5 h-2.5 border-r border-b border-border" />

        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="p-2 rounded-sm border border-border bg-muted/40">
              <div className="text-primary w-5 h-5">{icon}</div>
            </div>
            {trend && (
              <div className={cn('flex items-center gap-1 text-xs font-medium font-mono', trendColor)}>
                <TrendIcon className="w-3 h-3" />
                <span>{trend.value.toFixed(0)}%</span>
              </div>
            )}
          </div>

          <div className="space-y-1 mb-3">
            <p className="text-xs font-medium text-muted-foreground">
              {label}
            </p>
            <div className="text-2xl font-bold font-mono text-foreground">
              <AnimatedNumber
                value={value}
                decimals={valueDecimals}
                suffix={valueSuffix}
                prefix={valuePrefix}
              />
            </div>
            {subLabel != null && (
              <div className="text-xs font-semibold text-muted-foreground mt-0.5">{subLabel}</div>
            )}
          </div>

          {sparklineData && sparklineData.length > 0 && (
            <div className="mt-3 -mx-2">
              {/* Suspense krävs av React.lazy — ingen synlig fallback för sparkline */}
              <Suspense fallback={null}>
                <SparklineChart
                  data={sparklineData}
                  color="hsl(var(--primary))"
                  height={32}
                />
              </Suspense>
            </div>
          )}
        </CardContent>
      </Card>
  );
};
