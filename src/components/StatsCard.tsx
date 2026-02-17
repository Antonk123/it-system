import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number;
  icon: ReactNode;
  className?: string;
  to?: string;
}

export const StatsCard = ({ title, value, icon, className, to }: StatsCardProps) => {
  const content = (
    <Card className={cn("transition-colors", to && "hover:bg-muted/50 cursor-pointer", className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold text-foreground mt-1">{value}</p>
          </div>
          <div className="p-3 rounded-lg bg-primary/10 text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (to) {
    return <Link to={to}>{content}</Link>;
  }

  return content;
};
