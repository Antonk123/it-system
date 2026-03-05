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
  animationDelay?: number;
  onClick?: () => void;
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
  animationDelay = 0,
  onClick,
}: KPICardProps) => {
  const TrendIcon = trend?.direction === 'up' ? TrendingUp : TrendingDown;
  const trendColor = trend
    ? trend.isPositive
      ? 'text-green-500'
      : 'text-red-500'
    : '';

  return (
    <div
      className="animate-fade-in"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <Card
        className={cn(
          'relative overflow-hidden transition-all duration-300 hover:-translate-y-1',
          'hover:shadow-2xl hover:shadow-primary/20',
          onClick && 'cursor-pointer',
          className
        )}
        onClick={onClick}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-primary/20 to-accent/10 backdrop-blur-sm">
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
            <div className="text-3xl font-bold">
              <AnimatedNumber
                value={value}
                decimals={valueDecimals}
                suffix={valueSuffix}
                prefix={valuePrefix}
                className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent"
              />
            </div>
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
        <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full opacity-50 pointer-events-none" />
      </Card>
    </div>
  );
};
