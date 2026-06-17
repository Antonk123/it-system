import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TagCloud } from '@/components/TagCloud';
import { TagDistributionChart } from '@/components/TagDistributionChart';
import { useTagAnalytics } from '@/hooks/useTagAnalytics';
import { cn } from '@/lib/utils';

interface TagAnalyticsProps {
  onTagClick?: (tagId: string) => void;
  className?: string;
}

export const TagAnalytics = ({
  onTagClick,
  className,
}: TagAnalyticsProps) => {
  // Server-side tag-frequency counts over the full dataset (no 1000-row cap).
  const { data: tagData = [], isLoading } = useTagAnalytics();

  if (isLoading) {
    return (
      <div className={cn('grid gap-6 lg:grid-cols-2', className)}>
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (tagData.length === 0) {
    return (
      <div className={cn('grid gap-6', className)}>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold font-serif">
              Tag Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center h-64 text-muted-foreground">
              No tag data available. Start adding tags to tickets to see analytics.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn('grid gap-6 lg:grid-cols-2', className)}>
      {/* Tag Cloud */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold font-serif">
            Tag Cloud
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Tag size reflects usage frequency
          </p>
        </CardHeader>
        <CardContent>
          <TagCloud
            tags={tagData}
            onTagClick={onTagClick}
          />
        </CardContent>
      </Card>

      {/* Tag Distribution Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold font-serif">
            Top Tags
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Most frequently used tags
          </p>
        </CardHeader>
        <CardContent>
          <TagDistributionChart
            tags={tagData}
            onTagClick={onTagClick}
            topN={10}
          />
        </CardContent>
      </Card>
    </div>
  );
};
