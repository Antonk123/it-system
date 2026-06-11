import { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { SparklineChart } from '@/components/SparklineChart';
import { cn } from '@/lib/utils';

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

  return (
    <Card
        className={cn(
          'relative overflow-hidden transition-all duration-300 hover:-translate-y-1',
          'hover:shadow-2xl hover:shadow-primary/20',
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
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="p-2 rounded-lg bg-linear-to-br from-primary/20 to-accent/10 backdrop-blur-xs">
              <div className="text-primary w-5 h-5">{icon}</div>
            </div>
            {trend && (
              <div className={cn('flex items-center gap-1 text-xs font-medium', trendColor)}>
                <TrendIcon className="w-3 h-3" />
                <span>{trend.value.toFixed(0)}%</span>
              </div>
            )}
          </div>

          <div className="space-y-1 mb-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {label}
            </p>
            <div className="text-2xl font-bold">
              <AnimatedNumber
                value={value}
                decimals={valueDecimals}
                suffix={valueSuffix}
                prefix={valuePrefix}
                className="bg-linear-to-r from-primary to-accent bg-clip-text text-transparent"
              />
            </div>
            {subLabel != null && (
              <div className="text-xs font-semibold text-muted-foreground mt-0.5">{subLabel}</div>
            )}
          </div>

          {sparklineData && sparklineData.length > 0 && (
            <div className="mt-3 -mx-2">
              <SparklineChart
                data={sparklineData}
                color="hsl(var(--primary))"
                height={32}
              />
            </div>
          )}
        </CardContent>

        {/* Decorative gradient overlay */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-linear-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50 pointer-events-none" />
      </Card>
  );
};
